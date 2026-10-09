import { addMonths, bsCalc, plCalc, type ClassKey } from "@/lib/engine";
import { normLabel } from "@/lib/ingest/parse";
import { buildMonths, isPL, toNatural, toRaw } from "./build";
import { checkKey, coverageOf, runChecks, type Check, type ControlTotal } from "./checks";
import type { AccountLine } from "./types";

/** Where an account's figures sit in the uploaded file. */
export interface SourceRef { sheet?: string; row?: number; label?: string }

/** One account of a stored data version (natural sign amounts) with per-month provenance. */
export interface VersionAccount {
  code: string;
  name: string;
  cls: ClassKey;
  amounts: Record<string, number>;
  /** Import that supplied each month; months absent here come from the import being written. */
  sources?: Record<string, string | null>;
  /** File location per import id ("new" = the import being written). */
  refs?: Record<string, SourceRef>;
  odoo_id?: number | null;
  odoo_type?: string | null;
  confidence?: number | null;
  mapped_by?: "auto" | "user" | "system";
}

export interface IncomingAccount {
  code: string;
  name: string;
  cls: ClassKey;
  amounts: Record<string, number>;
  confidence?: number | null;
  mapped_by?: "auto" | "user" | "system";
  ref?: SourceRef;
}

export type ImportMode = "merge" | "replace";
export type Statement = "PL" | "BS";
/** Months the file covers, per statement. A covered month replaces the stored month even where the file has zeros. */
export type Slices = Record<Statement, string[]>;
export type SliceState = "new" | "overwrite" | "keep" | "remove";
export interface TimelineCell { period: string; PL?: SliceState; BS?: SliceState }
export interface MonthDiff { period: string; metric: "revenue" | "net_income" | "cash" | "ta"; before: number; after: number }

export interface ImportPlan {
  accounts: VersionAccount[];
  timeline: TimelineCell[];
  diffs: MonthDiff[];
  checks: Check[];
}

export const statementOf = (cls: ClassKey): Statement => (isPL(cls) ? "PL" : "BS");

/** Accounts are the same across uploads when the code matches, or (without a code) the name within the same statement. */
export function accountIdentity(a: { code: string; name: string; cls: ClassKey }) {
  const code = a.code.trim().toLowerCase();
  return code ? `c:${code}` : `n:${statementOf(a.cls)}:${normLabel(a.name)}`;
}

const recast = (from: ClassKey, to: ClassKey, v: number) => (from === to ? v : toNatural(to, toRaw(from, v)));

export function planImport(current: VersionAccount[], incoming: IncomingAccount[], opts: { mode: ImportMode; slices: Slices; controls?: ControlTotal[]; extra?: Check[] }): ImportPlan {
  const inc: Record<Statement, Set<string>> = { PL: new Set(opts.slices.PL), BS: new Set(opts.slices.BS) };
  // Every month the file has a figure for is covered, whatever the caller declared.
  for (const n of incoming) for (const p of Object.keys(n.amounts)) inc[statementOf(n.cls)].add(p);
  const covered = (cls: ClassKey, p: string) => inc[statementOf(cls)].has(p);
  const out = new Map<string, VersionAccount>();

  if (opts.mode === "merge") {
    for (const a of current) {
      const amounts: Record<string, number> = {}, sources: Record<string, string | null> = {};
      for (const [p, v] of Object.entries(a.amounts)) if (v && !covered(a.cls, p)) { amounts[p] = v; sources[p] = a.sources?.[p] ?? null; }
      const k = accountIdentity(a);
      const prev = out.get(k);
      if (prev) { // two stored accounts with the same identity: fold them together
        for (const [p, v] of Object.entries(amounts)) { prev.amounts[p] = (prev.amounts[p] ?? 0) + recast(a.cls, prev.cls, v); prev.sources![p] ??= sources[p]; }
        Object.assign(prev.refs!, a.refs ?? {});
      } else out.set(k, { ...a, amounts, sources, refs: { ...(a.refs ?? {}) } });
    }
  }

  for (const n of incoming) {
    const k = accountIdentity(n);
    const ex = out.get(k);
    if (!ex) {
      out.set(k, { code: n.code, name: n.name, cls: n.cls, amounts: { ...n.amounts }, sources: {}, refs: n.ref ? { new: n.ref } : {}, confidence: n.confidence ?? null, mapped_by: n.mapped_by ?? "auto" });
      continue;
    }
    // A class the user chose in the chart of accounts survives re-uploads (within the same statement).
    const keepUser = ex.mapped_by === "user" && n.mapped_by !== "user" && statementOf(ex.cls) === statementOf(n.cls);
    const cls = keepUser ? ex.cls : n.cls;
    if (cls !== ex.cls) for (const p of Object.keys(ex.amounts)) ex.amounts[p] = recast(ex.cls, cls, ex.amounts[p]);
    for (const [p, v] of Object.entries(n.amounts)) ex.amounts[p] = (ex.amounts[p] ?? 0) + recast(n.cls, cls, v);
    ex.cls = cls;
    ex.code = n.code || ex.code;
    ex.name = n.name || ex.name;
    if (!keepUser) { ex.mapped_by = n.mapped_by ?? "auto"; ex.confidence = n.confidence ?? null; }
    if (n.ref && !ex.refs?.new) ex.refs = { ...(ex.refs ?? {}), new: n.ref };
  }

  const accounts: VersionAccount[] = [];
  for (const a of out.values()) {
    const amounts = Object.fromEntries(Object.entries(a.amounts).map(([p, v]) => [p, Math.round(v * 100) / 100] as const).filter(([, v]) => v !== 0));
    if (!Object.keys(amounts).length) continue;
    const sources = Object.fromEntries(Object.entries(a.sources ?? {}).filter(([p]) => p in amounts));
    const used = new Set(Object.values(sources).filter(Boolean) as string[]);
    const hasNew = Object.keys(amounts).some((p) => !(p in sources));
    const refs = Object.fromEntries(Object.entries(a.refs ?? {}).filter(([id]) => (id === "new" ? hasNew : used.has(id))));
    accounts.push({ ...a, amounts, sources, refs });
  }

  // timeline and before/after for overwritten months
  const curCov = coverageOf(current);
  const all = [...curCov.range, ...inc.PL, ...inc.BS].sort();
  const timeline: TimelineCell[] = [];
  if (all.length) for (let p = all[0]; p <= all[all.length - 1]; p = addMonths(p, 1)) {
    const cell: TimelineCell = { period: p };
    for (const st of ["PL", "BS"] as const) {
      const had = (st === "PL" ? curCov.pl : curCov.bs).has(p);
      if (inc[st].has(p)) cell[st] = had ? "overwrite" : "new";
      else if (had) cell[st] = opts.mode === "merge" ? "keep" : "remove";
    }
    timeline.push(cell);
  }
  const before = new Map(buildMonths(current.map(asLine)).map((m) => [m.period, m]));
  const after = new Map(buildMonths(accounts.map(asLine)).map((m) => [m.period, m]));
  const diffs: MonthDiff[] = [];
  for (const c of timeline) {
    const b = before.get(c.period), a = after.get(c.period);
    if (c.PL === "overwrite" && b && a) for (const metric of ["revenue", "net_income"] as const) diffs.push({ period: c.period, metric, before: plCalc(b.pl)[metric], after: plCalc(a.pl)[metric] });
    if (c.BS === "overwrite" && b && a) for (const metric of ["cash", "ta"] as const) diffs.push({ period: c.period, metric, before: bsCalc(b.bs)[metric], after: bsCalc(a.bs)[metric] });
  }

  // Checks run on the merged result. In a merge, failures in months this file doesn't touch are existing issues and don't block it.
  const touched = new Set<string>();
  for (const st of ["PL", "BS"] as const) for (const p of inc[st]) { touched.add(p); touched.add(addMonths(p, 1)); }
  const checks = runChecks({ accounts: accounts.map(asLine), controls: opts.controls, extra: opts.extra })
    .map((c) => (opts.mode === "merge" && c.period && !touched.has(c.period) ? { ...c, existing: true } : c));
  return { accounts, timeline, diffs, checks };
}

const asLine = (a: VersionAccount): AccountLine => ({ id: accountIdentity(a), code: a.code, name: a.name, cls: a.cls, amounts: a.amounts });

/** Blocking failures this import must not write without an explicit acceptance. */
export function unresolved(checks: Check[], accepted: Iterable<string>): Check[] {
  const ok = new Set(accepted);
  return checks.filter((c) => c.severity === "block" && !c.existing && !ok.has(checkKey(c)));
}

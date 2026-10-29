import { addMonths, mlabel, bsCalc, plCalc, type ClassKey } from "@/lib/engine";
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

/**
 * merge: the months in the file replace the same months already loaded; other months stay.
 * add: only months not loaded yet are added; months already loaded are kept as they are.
 * replace: everything loaded is removed and only the file is kept.
 */
export type ImportMode = "merge" | "add" | "replace";
export type Statement = "PL" | "BS";
/** Months the file covers, per statement. A covered month replaces the stored month even where the file has zeros. */
export type Slices = Record<Statement, string[]>;
export type SliceState = "new" | "overwrite" | "keep" | "remove";
export interface TimelineCell { period: string; PL?: SliceState; BS?: SliceState }
export interface MonthDiff { period: string; metric: "revenue" | "net_income" | "cash" | "ta"; before: number; after: number }

/** A month (of one statement) that is both in the file and already loaded, and whether the figures are the same. */
export interface Overlap { period: string; statement: Statement; same: boolean }

export interface ImportPlan {
  accounts: VersionAccount[];
  timeline: TimelineCell[];
  diffs: MonthDiff[];
  checks: Check[];
  /** Months in the file that are already loaded (whatever the mode): the duplicates the person decides about. */
  overlap: Overlap[];
}

export const statementOf = (cls: ClassKey): Statement => (isPL(cls) ? "PL" : "BS");

/** The accounts a change of class would move between the P&L and the balance sheet (their stored months mean different things there). */
export function statementMoves(current: { id: string; class: string }[], changes: Record<string, string>): string[] {
  return current.filter((a) => a.id in changes && statementOf(a.class as ClassKey) !== statementOf(changes[a.id] as ClassKey)).map((a) => a.id);
}

/** Accounts are the same across uploads when the code matches, or (without a code) the name within the same statement. */
export function accountIdentity(a: { code: string; name: string; cls: ClassKey }) {
  const code = a.code.trim().toLowerCase();
  return code ? `c:${code}` : `n:${statementOf(a.cls)}:${normLabel(a.name)}`;
}

const recast = (from: ClassKey, to: ClassKey, v: number) => (from === to ? v : toNatural(to, toRaw(from, v)));

export function planImport(currentIn: VersionAccount[], incomingIn: IncomingAccount[], optsIn: { mode: ImportMode; slices: Slices; controls?: ControlTotal[]; extra?: Check[]; ranges?: Record<string, number>; openingFrom?: string | null; booksStart?: string | null; opening?: { asAt: string } | null; zeroMonths?: string[]; unit?: number }): ImportPlan {
  // "add" reads the file exactly as a merge does, then leaves out the months already loaded.
  const opts = { ...optsIn, mode: optsIn.mode === "add" ? "merge" as const : optsIn.mode };
  // Before the books start there is no trading: stored P&L months before it and balance sheets before the opening month go.
  const startPL = optsIn.booksStart ? optsIn.booksStart.slice(0, 7) : null;
  const beforeStart = (st: Statement, p: string) => !!startPL && p < (st === "PL" ? startPL : addMonths(startPL, -1));
  const current = startPL ? currentIn.map((a) => ({ ...a, amounts: Object.fromEntries(Object.entries(a.amounts).filter(([p]) => !beforeStart(statementOf(a.cls), p))) })) : currentIn;
  const seeded = seedOpening(current, incomingIn, opts);
  const derived = deriveRanges(current, seeded.incoming, opts);
  const rangeChecks: Check[] = [...derived.rangeChecks, ...seeded.checks];
  const inc: Record<Statement, Set<string>> = { PL: new Set(opts.slices.PL), BS: new Set(opts.slices.BS) };
  // Every month the file has a figure for is covered, whatever the caller declared.
  for (const n of derived.incoming) for (const p of Object.keys(n.amounts)) inc[statementOf(n.cls)].add(p);
  const loaded = coverageOf(current);
  const isLoaded = (st: Statement, p: string) => (st === "PL" ? loaded.pl : loaded.bs).has(p);
  const overlap = overlaps(current, derived.incoming, inc, isLoaded);
  const continuity = opts.mode === "merge" ? continuityCheck(current, derived.incoming, isLoaded) : [];
  let incoming = derived.incoming;
  if (optsIn.mode === "add") {
    for (const st of ["PL", "BS"] as const) for (const p of [...inc[st]]) if (isLoaded(st, p)) inc[st].delete(p);
    incoming = incoming.map((a) => ({ ...a, amounts: Object.fromEntries(Object.entries(a.amounts).filter(([p]) => inc[statementOf(a.cls)].has(p))) }));
  }
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
    // Moving between the P&L and the balance sheet changes what each stored month means (a month's movement against a
    // closing balance): the months the file does not cover cannot be converted, so only the file's months are kept.
    if (statementOf(cls) !== statementOf(ex.cls)) { ex.amounts = {}; ex.sources = {}; }
    else if (cls !== ex.cls) for (const p of Object.keys(ex.amounts)) ex.amounts[p] = recast(ex.cls, cls, ex.amounts[p]);
    for (const [p, v] of Object.entries(n.amounts)) ex.amounts[p] = (ex.amounts[p] ?? 0) + recast(n.cls, cls, v);
    ex.cls = cls;
    ex.code = n.code || ex.code;
    ex.name = n.name || ex.name;
    if (!keepUser) { ex.mapped_by = n.mapped_by ?? "auto"; ex.confidence = n.confidence ?? null; }
    if (n.ref && !ex.refs?.new) ex.refs = { ...(ex.refs ?? {}), new: n.ref };
  }

  // Opening balances uploaded on their own: balances later built from zero (no opening at the time) move by each
  // account's opening; balances built on a file's own opening for that day must agree with it.
  const shifted = new Set<string>();
  const openingChecks: Check[] = [];
  if (optsIn.opening) {
    const m0 = optsIn.opening.asAt.slice(0, 7);
    const zeroMonths = new Set((optsIn.zeroMonths ?? []).filter((p) => p > m0));
    // Accounts are matched as an accountant reads them: by code and name together ("xy" + "opining balance" is
    // "xy opining balance"), every retained-earnings line, computed or not, as one retained earnings figure, and by
    // debit or credit balance, so an account classed differently on each side is not a difference in money.
    const keyOf = (a: { code: string; name: string; cls: ClassKey }) => (a.cls === "retained_earnings" ? "retained earnings" : `${a.code} ${a.name}`.trim().toLowerCase().replace(/\s+/g, " "));
    const at = (xs: { code: string; name: string; cls: ClassKey; amounts: Record<string, number> }[]) => {
      const m = new Map<string, { label: string; v: number }>();
      for (const a of xs) if (!isPL(a.cls) && a.amounts[m0] !== undefined) { const k = keyOf(a); const e = m.get(k) ?? { label: k === "retained earnings" ? "Retained earnings" : `${a.code ? `${a.code} ` : ""}${a.name}`, v: 0 }; e.v += toRaw(a.cls, a.amounts[m0]); m.set(k, e); }
      return m;
    };
    const was = at(current), now = at(incoming);
    const off: string[] = [];
    if (was.size) for (const k of new Set([...was.keys(), ...now.keys()])) {
      const a = now.get(k)?.v ?? 0, b = was.get(k)?.v ?? 0;
      const dc = (v: number) => `${Math.round(Math.abs(v)).toLocaleString("en-GB")}${Math.abs(v) < 0.5 ? "" : v > 0 ? " Dr" : " Cr"}`;
      if (Math.abs(a - b) > 1) off.push(`${(now.get(k) ?? was.get(k))!.label}: ${dc(a)} here, ${dc(b)} loaded`);
    }
    for (const n of incoming) {
      if (isPL(n.cls) || !n.amounts[m0]) continue;
      const ex = out.get(accountIdentity(n))!;
      for (const p of zeroMonths) {
        if (!current.some((a) => !isPL(a.cls) && a.amounts[p] !== undefined)) continue;
        ex.amounts[p] = Math.round(((ex.amounts[p] ?? 0) + recast(n.cls, ex.cls, n.amounts[m0])) * 100) / 100;
        shifted.add(p);
      }
    }
    if (off.length) openingChecks.push({ id: "continuity", severity: "block", period: m0, statement: "BS", title: `${off.length} opening balance${off.length > 1 ? "s differ" : " differs"} from the books already loaded`, detail: `The months loaded after ${m0} were built on other opening balances: ${off.slice(0, 5).join("; ")}${off.length > 5 ? "…" : ""}. Correct the opening balances, or upload the ledger again after them.` });
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
  const curCov = coverageOf(currentIn);
  const all = [...curCov.range, ...inc.PL, ...inc.BS].sort();
  const timeline: TimelineCell[] = [];
  if (all.length) for (let p = all[0]; p <= all[all.length - 1]; p = addMonths(p, 1)) {
    const cell: TimelineCell = { period: p };
    for (const st of ["PL", "BS"] as const) {
      const had = (st === "PL" ? curCov.pl : curCov.bs).has(p);
      if (inc[st].has(p) || (st === "BS" && shifted.has(p))) cell[st] = had ? "overwrite" : "new";
      else if (had) cell[st] = opts.mode === "merge" && !beforeStart(st, p) ? "keep" : "remove";
    }
    timeline.push(cell);
  }
  const before = new Map(buildMonths(currentIn.map(asLine)).map((m) => [m.period, m]));
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
  for (const p of shifted) touched.add(p);
  const checks = runChecks({ accounts: accounts.map(asLine), controls: opts.controls, unit: opts.unit, extra: [...(opts.extra ?? []), ...rangeChecks, ...continuity, ...openingChecks] })
    .map((c) => (opts.mode === "merge" && c.period && !touched.has(c.period) ? { ...c, existing: true } : c));
  return { accounts, timeline, diffs, checks, overlap };
}

/**
 * A file that brings its own opening balances (the balance sheet of the month before its first P&L month) must agree, account
 * by account, with that month as already loaded: otherwise the company's history breaks at the join (a back-dated entry, an
 * export from another company, or a different chart). Each account that differs by more than 1 is named.
 */
function continuityCheck(current: VersionAccount[], incoming: IncomingAccount[], isLoaded: (st: Statement, p: string) => boolean): Check[] {
  const bsMonths = [...new Set(incoming.filter((a) => !isPL(a.cls)).flatMap((a) => Object.keys(a.amounts)))].sort();
  const plMonths = new Set(incoming.filter((a) => isPL(a.cls)).flatMap((a) => Object.keys(a.amounts)));
  const p0 = bsMonths[0];
  const firstPL = [...plMonths].sort()[0];
  // Only a true opening: the balance sheet of the month just before the file's first P&L month (not a balance-sheet correction).
  if (!p0 || !firstPL || addMonths(p0, 1) !== firstPL || !isLoaded("BS", p0)) return [];
  const sum = (as: { code: string; name: string; cls: ClassKey; amounts: Record<string, number> }[]) => {
    const m = new Map<string, { label: string; cls: ClassKey; v: number }>();
    for (const a of as) {
      if (isPL(a.cls)) continue;
      const k = accountIdentity(a), e = m.get(k) ?? { label: `${a.code} ${a.name}`.trim(), cls: a.cls, v: 0 };
      e.v += a.amounts[p0] ?? 0;
      m.set(k, e);
    }
    return m;
  };
  const was = sum(current), now = sum(incoming);
  const off: { label: string; a: number; b: number }[] = [];
  for (const k of new Set([...was.keys(), ...now.keys()])) {
    const w = was.get(k), n = now.get(k);
    const a = w ? (n ? recast(w.cls, n.cls, w.v) : w.v) : 0, b = n?.v ?? 0;
    if (Math.abs(a - b) > 1) off.push({ label: (n ?? w)!.label, a, b });
  }
  if (!off.length) return [];
  off.sort((x, y) => Math.abs(y.b - y.a) - Math.abs(x.b - x.a));
  const f = (v: number) => Math.round(v).toLocaleString("en-US");
  const total = off.reduce((s2, o) => s2 + Math.abs(o.b - o.a), 0);
  return [{ id: "continuity", severity: "block", period: p0, statement: "BS", title: `Opening balances differ from ${p0} as loaded`,
    detail: `${off.length} account${off.length > 1 ? "s" : ""} open differently from the balance sheet already loaded for ${p0} (${f(total)} in all): ${off.slice(0, 5).map((o) => `${o.label}: loaded ${f(o.a)}, this file ${f(o.b)}`).join("; ")}${off.length > 5 ? "…" : ""}. Check for entries posted back-dated in Odoo, or that the export is for the same company, then accept with a reason or replace the earlier months.`,
    expected: Math.round(total * 100) / 100, actual: 0, diff: Math.round(total * 100) / 100 }];
}

/** Months in the file that are already loaded, each marked the same (every account equal to the cent) or different. */
function overlaps(current: VersionAccount[], incoming: IncomingAccount[], inc: Record<Statement, Set<string>>, isLoaded: (st: Statement, p: string) => boolean): Overlap[] {
  const out: Overlap[] = [];
  for (const st of ["PL", "BS"] as const) for (const p of [...inc[st]].sort()) {
    if (!isLoaded(st, p)) continue;
    const sum = (as: { code: string; name: string; cls: ClassKey; amounts: Record<string, number> }[]) => {
      const m = new Map<string, number>();
      for (const a of as) if (statementOf(a.cls) === st && a.amounts[p]) m.set(accountIdentity(a), (m.get(accountIdentity(a)) ?? 0) + a.amounts[p]);
      return m;
    };
    const a = sum(current), b = sum(incoming);
    const same = a.size === b.size && [...a].every(([k, v]) => Math.abs((b.get(k) ?? NaN) - v) < 0.01);
    out.push({ period: p, statement: st, same });
  }
  return out;
}

/**
 * A movement file (general ledger, journal items) without opening balances builds each balance from zero. Merged onto
 * loaded data, balances continue from the stored balance sheet of the month before the file starts.
 */
function seedOpening(current: VersionAccount[], incoming: IncomingAccount[], opts: { mode: ImportMode; slices: Slices; openingFrom?: string | null }) {
  const checks: Check[] = [];
  const p0 = opts.openingFrom;
  if (!p0) return { incoming, checks };
  const prev = addMonths(p0, -1);
  const stored = opts.mode === "merge" ? current.filter((a) => !isPL(a.cls) && a.amounts[prev]) : [];
  if (!stored.length) {
    const hasBS = opts.mode === "merge" && coverageOf(current).bs.size > 0;
    checks.push(hasBS
      ? { id: "opening", severity: "block", period: p0, statement: "BS", title: "No opening balances to continue from", detail: `The file has movements only, starting ${p0}, and the balance sheet for ${prev} is not loaded, so closing balances would start from zero. Load ${prev} first, or export a Trial Balance with an Initial Balance column.` }
      : { id: "opening", severity: "warn", period: p0, statement: "BS", title: "Balances start from zero", detail: `The file has no opening balances, so every balance is built from the movements since ${p0}. This is only right if the export starts at the company's first entry.` });
    return { incoming, checks };
  }
  const months = new Set([...opts.slices.BS, ...incoming.filter((a) => !isPL(a.cls)).flatMap((a) => Object.keys(a.amounts))]);
  const out = incoming.map((a) => ({ ...a, amounts: { ...a.amounts } }));
  const byKey = new Map(out.filter((a) => !isPL(a.cls)).map((a) => [accountIdentity(a), a]));
  for (const st of stored) {
    const key = accountIdentity(st);
    let a = byKey.get(key);
    if (!a) { a = { code: st.code, name: st.name, cls: st.cls, amounts: {}, mapped_by: st.mapped_by, confidence: st.confidence }; out.push(a); byKey.set(key, a); }
    const open = recast(st.cls, a.cls, st.amounts[prev]);
    for (const p of months) a.amounts[p] = Math.round(((a.amounts[p] ?? 0) + open) * 100) / 100;
  }
  checks.push({ id: "opening", severity: "info", period: p0, statement: "BS", title: "Opening balances taken from loaded data", detail: `The file has movements only; balances continue from the ${prev} balance sheet already loaded.` });
  return { incoming: out, checks };
}

/**
 * A P&L figure covering several months (a range or year-to-date column) becomes its last month by subtracting the
 * earlier months of the range, taken from this file or from the data already loaded. When they are not all available
 * the figure is kept as a whole and a blocking check says so (accepting it stores the range total as one month).
 */
function deriveRanges(current: VersionAccount[], incoming: IncomingAccount[], opts: { mode: ImportMode; slices: Slices; ranges?: Record<string, number> }) {
  const rangeChecks: Check[] = [];
  const ranges = Object.entries(opts.ranges ?? {}).filter(([, k]) => k > 1);
  if (!ranges.length) return { incoming, rangeChecks };
  const fileMonths = new Set([...opts.slices.PL, ...incoming.filter((a) => isPL(a.cls)).flatMap((a) => Object.keys(a.amounts))]);
  const stored = opts.mode === "merge" ? current.filter((a) => isPL(a.cls)) : [];
  const storedCov = coverageOf(stored).pl;
  const out = incoming.map((a) => ({ ...a, amounts: { ...a.amounts } }));
  const byKey = new Map(out.filter((a) => isPL(a.cls)).map((a) => [accountIdentity(a), a]));
  const storedByKey = new Map(stored.map((a) => [accountIdentity(a), a]));
  for (const [p, k] of ranges) {
    const earlier = Array.from({ length: k - 1 }, (_, i) => addMonths(p, i - (k - 1)));
    // A month the file itself reports is a single month unless it is also a range end.
    const fromFile = (q: string) => fileMonths.has(q) && !(opts.ranges?.[q] && opts.ranges[q] > 1);
    const missing = earlier.filter((q) => !fromFile(q) && !storedCov.has(q));
    if (missing.length) {
      rangeChecks.push({ id: "multi_month", severity: "block", period: p, statement: "PL", title: `P&L figure covers ${k} months, not one`,
        detail: `This file has one total for ${mlabel(earlier[0])} to ${mlabel(p)}, not a figure for each month. For monthly analysis, upload Odoo's General Ledger for the same dates (it gives every month; this file can go with it to check the totals). Or load ${missing.length === k - 1 ? "the earlier months" : `the missing months (${missing.slice(0, 4).map(mlabel).join(", ")}${missing.length > 4 ? "…" : ""})`} first, or import anyway to keep the ${k}-month total in ${mlabel(p)}.` });
      continue;
    }
    const prior = (key: string, cls: ClassKey) => earlier.reduce((s, q) => {
      if (fromFile(q)) { const a = byKey.get(key); return s + (a ? a.amounts[q] ?? 0 : 0); }
      const st = storedByKey.get(key);
      return s + (st && st.amounts[q] ? recast(st.cls, cls, st.amounts[q]) : 0);
    }, 0);
    const keys = new Set([...byKey.keys(), ...[...storedByKey.entries()].filter(([, a]) => earlier.some((q) => a.amounts[q])).map(([key]) => key)]);
    for (const key of keys) {
      let a = byKey.get(key);
      if (!a) { // in the earlier months but not in this file: its total for the range is zero
        const st = storedByKey.get(key)!;
        a = { code: st.code, name: st.name, cls: st.cls, amounts: {}, mapped_by: st.mapped_by, confidence: st.confidence };
        out.push(a); byKey.set(key, a);
      }
      a.amounts[p] = Math.round(((a.amounts[p] ?? 0) - prior(key, a.cls)) * 100) / 100;
    }
  }
  return { incoming: out, rangeChecks };
}

const asLine = (a: VersionAccount): AccountLine => ({ id: accountIdentity(a), code: a.code, name: a.name, cls: a.cls, amounts: a.amounts });

/** Blocking failures this import must not write without an explicit acceptance. */
export function unresolved(checks: Check[], accepted: Iterable<string>): Check[] {
  const ok = new Set(accepted);
  return checks.filter((c) => c.severity === "block" && !c.existing && !ok.has(checkKey(c)));
}

import { bsCalc, plCalc, type ClassKey } from "@/lib/engine";
import { buildMonths, isPL } from "@/lib/company/build";
import type { AccountLine } from "@/lib/company/types";
import type { Check } from "@/lib/company/checks";
import { CLASS_LABEL, CLASS_OPTIONS } from "./classes";
import { materialUnmapped, type IngestLine, type IngestResult } from "./pipeline";
import type { RawLine, SheetLayout } from "./extract";
import type { SalesLayout } from "./sales";
import type { ExpenseLayout } from "./expenses";
import type { CashLayout } from "./cashbook";
import type { BankLayout } from "./bank";
import type { RoleGuess } from "./roles";
import type { Marks, TraceRow } from "./trace";

/**
 * iReport's reading of an upload, in its own format: every account under its class, in the P&L and balance sheet order
 * the system uses, with the totals iReport works out itself. This is the right-hand box beside the file as uploaded.
 */
export interface SortedRow {
  key: string; code: string; name: string; cls: ClassKey | null; conf: number; why: string;
  values: Record<string, number>;
  /** The rows of the file it was read from (account row, dated entries, opening balance). */
  src: { sheet: string; rows: number[] };
  status: "ok" | "check" | "error";
  system: boolean;
}
export interface SortedGroup { cls: ClassKey; label: string; rows: SortedRow[]; total: Record<string, number> }
export interface SortedTotal { after: ClassKey; label: string; values: Record<string, number>; strong?: boolean; zero?: boolean }
export interface LeftOut { key: string; label: string; sheet: string; rows: number[]; why: string; values: Record<string, number> }
export interface SortedFinancials {
  plPeriods: string[]; bsPeriods: string[];
  pl: SortedGroup[]; bs: SortedGroup[];
  plTotals: SortedTotal[]; bsTotals: SortedTotal[];
  /** Lines read but not imported: totals iReport recomputes, parent accounts, lines you excluded, accounts with no amounts. */
  leftOut: LeftOut[];
  /** Lines that need a class before anything can be imported. */
  unmapped: SortedRow[];
}

/** File rows behind each line, from the sheets' traces. */
function rowsByRef(layouts: SheetLayout[]) {
  const by = new Map<string, { sheet: string; rows: number[] }>();
  for (const l of layouts) (l.trace ?? []).forEach((t, i) => {
    if (!t?.ref) return;
    const e = by.get(t.ref) ?? { sheet: l.sheet, rows: [] };
    e.rows.push(i);
    by.set(t.ref, e);
  });
  return by;
}

const PL_TOTALS: { after: ClassKey; label: string; pick: (c: ReturnType<typeof plCalc>) => number; strong?: boolean }[] = [
  { after: "cos_depreciation", label: "Gross profit", pick: (c) => c.gross_profit },
  { after: "exp_depreciation", label: "Operating profit", pick: (c) => c.operating_profit },
  { after: "adjustments", label: "Net profit", pick: (c) => c.net_income, strong: true },
];
const BS_TOTALS: { after: ClassKey; label: string; pick: (c: ReturnType<typeof bsCalc>) => number; strong?: boolean; zero?: boolean }[] = [
  { after: "investments", label: "Total assets", pick: (c) => c.ta, strong: true },
  { after: "other_ncl", label: "Total liabilities", pick: (c) => c.tl },
  { after: "other_equity", label: "Total equity", pick: (c) => c.te },
  { after: "other_equity", label: "Liabilities and equity", pick: (c) => c.tle, strong: true },
  { after: "other_equity", label: "Difference (must be 0)", pick: (c) => c.imbalance, zero: true },
];

export function sortedFinancials(res: IngestResult, raw: RawLine[] = []): SortedFinancials {
  const src = rowsByRef(res.layouts);
  const unmappedKeys = new Set(materialUnmapped(res).map((l) => l.key));
  const errorRows = new Set(res.layouts.flatMap((l) => (l.cellErrors ?? []).map((e) => `${l.sheet}|${e.row}`)));
  const row = (l: IngestLine): SortedRow => {
    const s = src.get(l.key) ?? { sheet: l.sheet, rows: [] };
    const broken = s.rows.some((r) => errorRows.has(`${s.sheet}|${r}`));
    return {
      key: l.key, code: l.code, name: l.name, cls: l.cls, conf: l.conf, why: l.why, values: l.values, src: s, system: l.system,
      status: broken || unmappedKeys.has(l.key) ? "error" : l.cls && !l.system && l.conf < 0.7 ? "check" : "ok",
    };
  };
  const included = res.lines.filter((l) => l.cls && !l.excluded);
  const groups = (pl: boolean): SortedGroup[] => CLASS_OPTIONS.filter((k) => isPL(k) === pl).flatMap((cls) => {
    const rows = included.filter((l) => l.cls === cls).map(row).sort((a, b) => Number(a.system) - Number(b.system) || a.code.localeCompare(b.code, "en", { numeric: true }) || a.name.localeCompare(b.name));
    if (!rows.length) return [];
    const total: Record<string, number> = {};
    for (const r of rows) for (const [p, v] of Object.entries(r.values)) total[p] = (total[p] ?? 0) + v;
    return [{ cls, label: CLASS_LABEL[cls], rows, total }];
  });
  const accts: AccountLine[] = included.map((l) => ({ id: l.key, code: l.code, name: l.name, cls: l.cls!, amounts: l.values }));
  const months = new Map(buildMonths(accts).map((m) => [m.period, m]));
  const per = <T,>(ps: string[], f: (p: string) => T) => Object.fromEntries(ps.map((p) => [p, f(p)]));
  const plPeriods = res.slices.PL, bsPeriods = res.slices.BS;
  const plTotals = PL_TOTALS.map((t) => ({ after: t.after, label: t.label, strong: t.strong, values: per(plPeriods, (p) => { const m = months.get(p); return m ? t.pick(plCalc(m.pl)) : 0; }) }));
  const bsTotals = BS_TOTALS.map((t) => ({ after: t.after, label: t.label, strong: t.strong, zero: t.zero, values: per(bsPeriods, (p) => { const m = months.get(p); return m ? t.pick(bsCalc(m.bs)) : 0; }) }));

  const leftOut: LeftOut[] = [];
  const inResult = new Set(res.lines.map((l) => l.key));
  for (const r of raw) if (!inResult.has(r.key)) {
    const s = src.get(r.key) ?? { sheet: r.sheet, rows: [] };
    leftOut.push({ key: r.key, label: r.label, sheet: r.sheet, rows: s.rows, why: res.removed[r.key] ?? "no amounts in the months read", values: r.values });
  }
  for (const l of res.lines) if (l.excluded && l.why === "excluded by you") {
    const s = src.get(l.key) ?? { sheet: l.sheet, rows: [] };
    leftOut.push({ key: l.key, label: l.label, sheet: l.sheet, rows: s.rows, why: "left out by you", values: l.values });
  }
  for (const l of res.lines) if (!l.cls && !l.system && l.why !== "excluded by you" && !unmappedKeys.has(l.key)) {
    const s = src.get(l.key) ?? { sheet: l.sheet, rows: [] };
    leftOut.push({ key: l.key, label: l.label, sheet: l.sheet, rows: s.rows, why: "no class found and too small to matter: pick a class to include it", values: l.values });
  }
  const unmapped = res.lines.filter((l) => unmappedKeys.has(l.key)).map(row);
  return { plPeriods, bsPeriods, pl: groups(true), bs: groups(false), plTotals, bsTotals, leftOut, unmapped };
}

/**
 * The sheet's trace after the import is worked out: rows whose line became a total, a parent account, a check sheet's
 * figure or an excluded line say so, so every row of the file shows what happened to it.
 */
export function finalTrace(layout: SheetLayout, res: IngestResult | null): Marks {
  const t = layout.trace ?? [];
  if (!res) return t;
  const byKey = new Map(res.lines.map((l) => [l.key, l]));
  return t.map((m): TraceRow | undefined => {
    if (!m?.ref || m.role === "error") return m;
    const why = res.removed[m.ref];
    if (why) return { role: /total/.test(why) || /parent/.test(why) ? "total" : "unused", ref: m.ref, note: why };
    const l = byKey.get(m.ref);
    if (!l) return m.role === "account" ? { role: "unused", ref: m.ref, note: "no amounts in the months read" } : m;
    if (l.excluded) return { ...m, role: "skipped", note: l.why === "excluded by you" ? "left out by you" : "needs a class" };
    return m;
  });
}

// ---------------------------------------------------------------- issues

/** One thing to fix (error: blocks the import until fixed) or to look at (check). */
export interface UploadIssue {
  id: string;
  severity: "error" | "check";
  sheet: string;
  /** Row / column in the sheet as uploaded, when the issue is at a place in the file. */
  row?: number; col?: number;
  message: string;
  /** How it is fixed in the box: retype the cell (or leave the row out), pick a class, or a setting / the sheet. */
  fix: "cell" | "class" | "settings";
  /** The line it concerns (class fixes). */
  key?: string;
  /** What the cell holds now (cell fixes), and whether it is an iReport template's class cell (fixed by picking a class). */
  text?: string;
  classCell?: boolean;
}

const FIX_CHECKS = new Set<Check["id"]>(["duplicate"]);

export function financialIssues(res: IngestResult, fileChecks: Check[] = []): UploadIssue[] {
  const out: UploadIssue[] = [];
  for (const l of res.layouts) for (const e of l.cellErrors ?? []) out.push({ id: `cell:${l.sheet}:${e.row}:${e.col}`, severity: "error", sheet: l.sheet, row: e.row, col: e.col, message: e.message, fix: "cell", text: e.text, classCell: !!l.source?.startsWith("iReport template") && e.col === 2 });
  const src = rowsByRef(res.layouts);
  for (const l of materialUnmapped(res)) {
    const s = src.get(l.key);
    out.push({ id: `class:${l.key}`, severity: "error", sheet: l.sheet, row: s?.rows[0], message: `"${l.label}" needs a class: pick one, or leave it out if it is a total or not an account.`, fix: "class", key: l.key });
  }
  for (const c of fileChecks) if (c.severity === "block" && FIX_CHECKS.has(c.id)) out.push({ id: `check:${c.id}:${c.title}`, severity: "error", sheet: "", message: `${c.title}. ${c.detail ?? ""}`.trim(), fix: "settings" });
  for (const l of res.lines) if (l.cls && !l.excluded && !l.system && l.conf < 0.7) {
    const s = src.get(l.key);
    out.push({ id: `conf:${l.key}`, severity: "check", sheet: l.sheet, row: s?.rows[0], message: `"${l.label}" was placed in ${CLASS_LABEL[l.cls]} with ${Math.round(l.conf * 100)}% confidence (${l.why}). Check the class.`, fix: "class", key: l.key });
  }
  for (const w of res.issues.warnings) out.push({ id: `warn:${w.slice(0, 80)}`, severity: "check", sheet: "", message: w, fix: "settings" });
  return out;
}

export function salesIssues(layouts: SalesLayout[]): UploadIssue[] {
  const out: UploadIssue[] = [];
  for (const l of layouts) {
    for (const e of l.errors) out.push({ id: `cell:${l.sheet}:${e.row}:${e.col}`, severity: "error", sheet: l.sheet, row: e.row, col: e.col, message: e.message, fix: "cell", text: e.text });
    if (l.taxIncluded) out.push({ id: `tax:${l.sheet}`, severity: "check", sheet: l.sheet, message: `${l.sheet}: only a total including tax was found, so sales would read about 14% high (VAT). Pick the "Untaxed Total" column if the file has one.`, fix: "settings" });
  }
  return out;
}

export function expenseIssues(layouts: ExpenseLayout[]): UploadIssue[] {
  const out: UploadIssue[] = [];
  for (const l of layouts) {
    for (const e of l.errors) out.push({ id: `cell:${l.sheet}:${e.row}:${e.col}`, severity: "error", sheet: l.sheet, row: e.row, col: e.col, message: e.message, fix: "cell", text: e.text });
    if (l.taxIncluded) out.push({ id: `tax:${l.sheet}`, severity: "check", sheet: l.sheet, message: `${l.sheet}: only a total including VAT was found, so costs would read about 14% high. Pick the "Untaxed" column if the file has one.`, fix: "settings" });
  }
  return out;
}

/** A cash book or bank statement: unreadable cells and totals that do not match block saving; what was not counted is listed. */
export function bookIssues(layouts: (CashLayout | BankLayout)[]): UploadIssue[] {
  const out: UploadIssue[] = [];
  for (const l of layouts) {
    for (const e of l.errors) out.push({ id: `cell:${l.sheet}:${e.row}:${e.col}`, severity: "error", sheet: l.sheet, row: e.row, col: e.col, message: e.message, fix: "cell", text: e.text });
    l.checks.forEach((c, i) => out.push({ id: `book:${l.sheet}:${i}`, severity: "check", sheet: l.sheet, row: c.row, col: c.col, message: c.message, fix: c.row !== undefined ? "cell" : "settings" }));
  }
  return out;
}

/** What iReport noticed about the file itself (cells far from the table, spreadsheet errors), for sheets it reads. */
export function sheetIssues(guesses: RoleGuess[], read: (sheet: string) => boolean): UploadIssue[] {
  return guesses.filter((g) => read(g.sheet)).flatMap((g) => g.notes.map((n, i) => ({ id: `sheet:${g.sheet}:${i}`, severity: "check" as const, sheet: g.sheet, message: `${g.sheet.split(" › ").pop()}: ${n}`, fix: "settings" as const })));
}

/** Lines (sales or expenses) by month, with each month's total. */
export function salesMonths(lines: { period: string; amount: number }[]) {
  const by = new Map<string, { n: number; amount: number }>();
  for (const l of lines) { const m = by.get(l.period) ?? { n: 0, amount: 0 }; m.n++; m.amount += l.amount; by.set(l.period, m); }
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([period, m]) => ({ period, ...m }));
}

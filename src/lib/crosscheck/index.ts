// One place where every module is checked against the others and against the books. The books are the master for money:
// a difference is shown on both sides with its months (and documents where both hold them), never adjusted away. A check
// whose other side isn't loaded is "not checked", never red; a module with no data has no check at all.
import { BS_KEYS, type ClassKey } from "@/lib/engine/types";
import { tieOut, type TieOut } from "@/lib/engine/tieout";
import { DEFS } from "@/lib/modules/defs";
import { modulesNow } from "@/lib/modules/registry";
import type { Bi, ModuleDef, TieDef } from "@/lib/modules/types";
import type { PeriodTotal } from "@/lib/modules/view";

export type CrossStatus = "agrees" | "differs" | "not_checked";
export interface CrossCheck {
  key: string; label: Bi;
  /** The module checked, and what it is checked against ("ledger" or another module). */
  a: string; b: string;
  status: CrossStatus;
  reason?: "no_books" | "no_overlap";
  /** One result per month both sides hold, oldest first. */
  months: TieOut[];
  /** The month with the largest difference (null when everything agrees or nothing was checked). */
  worst: TieOut | null;
}

export interface CrossInput {
  accounts: { cls: ClassKey; amounts: Record<string, number> }[];
  /** Sales and expense lines, totalled by month. */
  sales?: Record<string, number>;
  expenses?: Record<string, number>;
  /** Modules kept in the shared store, and open items, by their own month totals. */
  generic: { key: string; periods: PeriodTotal[] }[];
  /** Definitions to read ties from (the catalog and custom modules join here). */
  defs?: ModuleDef[];
}

function check(tie: TieDef, a: string, totals: Record<string, number>, x: CrossInput): CrossCheck | null {
  const months = Object.keys(totals).filter((p) => totals[p] !== 0 || p in totals).sort();
  if (!months.length) return null;
  const base = { key: tie.key, label: tie.label, a, b: "ledger" };
  const cls = new Set<string>(tie.classes);
  // The months the books cover for this tie: P&L months for a movement, balance-sheet months for a balance. A month the
  // books hold only on the other statement (an opening balance sheet, a P&L-only upload) is not checked, never red.
  const bs = new Set<string>(BS_KEYS);
  const side = (c: string) => (tie.basis === "balance" ? bs.has(c) : !bs.has(c));
  const held = new Set(x.accounts.filter((acc) => side(acc.cls)).flatMap((acc) => Object.keys(acc.amounts)));
  if (!held.size) return { ...base, status: "not_checked", reason: "no_books", months: [], worst: null };
  const both = months.filter((p) => held.has(p));
  if (!both.length) return { ...base, status: "not_checked", reason: "no_overlap", months: [], worst: null };
  const ledger = (p: string) => x.accounts.reduce((s, acc) => s + (cls.has(acc.cls) ? acc.amounts[p] ?? 0 : 0), 0);
  const out = both.map((p) => tieOut(tie.key, p, totals[p], ledger(p)));
  const off = out.filter((t) => t.status === "off").sort((m, n) => Math.abs(n.diff ?? 0) - Math.abs(m.diff ?? 0));
  return { ...base, status: off.length ? "differs" : "agrees", months: out, worst: off[0] ?? null };
}

export function crossChecks(x: CrossInput, visible: (module: string) => boolean = () => true): CrossCheck[] {
  const totals: Record<string, Record<string, number>> = {};
  if (x.sales) totals.sales = x.sales;
  if (x.expenses) totals.expenses = x.expenses;
  for (const g of x.generic) {
    const t: Record<string, number> = {};
    for (const p of g.periods) t[p.period] = (t[p.period] ?? 0) + p.amount;
    totals[g.key] = t;
  }
  const out: CrossCheck[] = [];
  // Every module the app knows now: the built-in ones, the catalog, and (in the browser) the company's own.
  for (const def of x.defs ?? modulesNow()) {
    const t = totals[def.key];
    if (!t || !Object.keys(t).length || !visible(def.key)) continue;
    for (const tie of def.ties ?? []) { const c = check(tie, def.key, t, x); if (c) out.push(c); }
  }
  return out;
}

/** A module's own checks (both sides), for the "Agrees with" strip on its pages. */
export const checksFor = (all: CrossCheck[], module: string) => all.filter((c) => c.a === module || c.b === module);

const COST_CLASSES = new Set<string>(DEFS.find((d) => d.key === "expenses")?.ties?.[0]?.classes ?? []);
const byMonth = <T,>(rows: T[], p: (r: T) => string, a: (r: T) => number) => { const m: Record<string, number> = {}; for (const r of rows) m[p(r)] = (m[p(r)] ?? 0) + a(r); return m; };
/** Sales lines totalled by month. */
export const salesTotals = (d: { customers: { p: string; a: number }[] }) => byMonth(d.customers, (r) => r.p, (r) => r.a);
/** Expense lines in cost classes totalled by month (stock purchases and unclassed lines are not costs). */
export const expenseTotals = (d: { accounts: { p: string; c: string | null; a: number }[] }) => byMonth(d.accounts.filter((r) => r.c && COST_CLASSES.has(r.c)), (r) => r.p, (r) => r.a);

/** The ageing reports as the open-items modules' totals at their as-of month, for the control-account checks. */
export function agedTotals(d: { aged: Partial<Record<"receivable" | "payable", { asOf: string; total: { total: number } }>> }): CrossInput["generic"] {
  const out: CrossInput["generic"] = [];
  for (const [side, key] of [["receivable", "ar_open"], ["payable", "ap_open"]] as const) {
    const a = d.aged[side];
    if (a?.asOf) out.push({ key, periods: [{ period: a.asOf.slice(0, 7), amount: a.total.total, qty: null, rows: 0 }] });
  }
  return out;
}

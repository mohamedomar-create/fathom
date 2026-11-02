import { EXPENSE_GROUPS, mlabel, type ClassKey } from "@/lib/engine";
import { differs } from "@/lib/tolerance";

export type LineKind = "sales" | "expenses";

const COSTS = new Set<ClassKey>(EXPENSE_GROUPS.flatMap((g) => g.classes));
/** Months whose ledger lines no longer add up to the P&L (revenue for sales, costs for expenses), to 1 EGP. */
export function untied(totals: Record<LineKind, Record<string, number>>, accounts: { cls: ClassKey; amounts: Record<string, number> }[]): Record<LineKind, string[]> {
  const pl = (keep: (c: ClassKey) => boolean, p: string) => accounts.reduce((s, a) => s + (keep(a.cls) ? a.amounts[p] ?? 0 : 0), 0);
  const off = (lines: number, want: number) => differs(lines, want);
  return {
    sales: Object.entries(totals.sales).filter(([p, v]) => off(v, pl((c) => c === "revenue", p))).map(([p]) => p).sort(),
    expenses: Object.entries(totals.expenses).filter(([p, v]) => off(v, pl((c) => COSTS.has(c), p))).map(([p]) => p).sort(),
  };
}


const months = (ps: string[]) => { const l = ps.map(mlabel); return l.length > 1 ? `${l.slice(0, -1).join(", ")} and ${l[l.length - 1]}` : l[0]; };

/** What the person is told when ledger lines were removed because they no longer match the P&L (null: nothing removed). */
export function clearedNotice(bad: Record<LineKind, string[]>): string | null {
  const parts = [bad.sales.length ? `sales lines for ${months(bad.sales)}` : "", bad.expenses.length ? `expense lines for ${months(bad.expenses)}` : ""].filter(Boolean);
  if (!parts.length) return null;
  const n = new Set([...bad.sales, ...bad.expenses]).size;
  const text = parts.join(" and ");
  return `${text[0].toUpperCase()}${text.slice(1)} no longer matched the P&L, so they were removed. Upload the General Ledger for ${n > 1 ? "those months" : "that month"} again to bring them back.`;
}

export interface Drift { kind: LineKind; period: string; lines: number; figures: number; diff: number }
/** Kept ledger lines that differ from the figures now saved (to 1 EGP): listed with the difference, never deleted. */
export function ledgerDrift(totals: Record<LineKind, Record<string, number>>, accounts: { cls: ClassKey; amounts: Record<string, number> }[]): Drift[] {
  const pl = (keep: (c: ClassKey) => boolean, p: string) => accounts.reduce((s, a) => s + (keep(a.cls) ? a.amounts[p] ?? 0 : 0), 0);
  const want: Record<LineKind, (p: string) => number> = { sales: (p) => pl((c) => c === "revenue", p), expenses: (p) => pl((c) => COSTS.has(c), p) };
  const out: Drift[] = [];
  for (const kind of ["sales", "expenses"] as const) {
    for (const [period, lines] of Object.entries(totals[kind]).sort(([a], [b]) => a.localeCompare(b))) {
      const figures = want[kind](period);
      if (differs(lines, figures)) out.push({ kind, period, lines, figures, diff: Math.round((lines - figures) * 100) / 100 });
    }
  }
  return out;
}

/** What the person is told about kept detail that no longer agrees (null: everything agrees). */
export function driftNotice(drift: Drift[]): string | null {
  if (!drift.length) return null;
  const parts = (["sales", "expenses"] as const).map((k) => {
    const d = drift.filter((x) => x.kind === k);
    if (!d.length) return "";
    const by = d.map((x) => (d.length > 1 ? `${mlabel(x.period)} by ${x.diff.toLocaleString("en-US")}` : `${mlabel(x.period)}`)).join(", ");
    const tail = d.length === 1 ? ` by ${d[0].diff.toLocaleString("en-US")}` : "";
    return `${k === "sales" ? "Sales" : "Expense"} detail for ${by} was kept but differs from the new figures${tail}.`;
  }).filter(Boolean);
  const n = new Set(drift.map((x) => x.period)).size;
  return `${parts.join(" ")} Upload the General Ledger for ${n > 1 ? "those months" : "that month"} to bring the detail in line.`;
}

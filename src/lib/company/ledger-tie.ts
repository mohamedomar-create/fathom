import { EXPENSE_GROUPS, type ClassKey } from "@/lib/engine";

export type LineKind = "sales" | "expenses";

const COSTS = new Set<ClassKey>(EXPENSE_GROUPS.flatMap((g) => g.classes));
/** Months whose ledger lines no longer add up to the P&L (revenue for sales, costs for expenses), within 0.5%. */
export function untied(totals: Record<LineKind, Record<string, number>>, accounts: { cls: ClassKey; amounts: Record<string, number> }[]): Record<LineKind, string[]> {
  const pl = (keep: (c: ClassKey) => boolean, p: string) => accounts.reduce((s, a) => s + (keep(a.cls) ? a.amounts[p] ?? 0 : 0), 0);
  const off = (lines: number, want: number) => Math.abs(lines - want) > Math.max(1, Math.abs(want) * 0.005);
  return {
    sales: Object.entries(totals.sales).filter(([p, v]) => off(v, pl((c) => c === "revenue", p))).map(([p]) => p).sort(),
    expenses: Object.entries(totals.expenses).filter(([p, v]) => off(v, pl((c) => COSTS.has(c), p))).map(([p]) => p).sort(),
  };
}


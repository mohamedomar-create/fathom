import { EXPENSE_GROUPS, mlabel, type ClassKey } from "@/lib/engine";

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


const months = (ps: string[]) => { const l = ps.map(mlabel); return l.length > 1 ? `${l.slice(0, -1).join(", ")} and ${l[l.length - 1]}` : l[0]; };

/** What the person is told when ledger lines were removed because they no longer match the P&L (null: nothing removed). */
export function clearedNotice(bad: Record<LineKind, string[]>): string | null {
  const parts = [bad.sales.length ? `sales lines for ${months(bad.sales)}` : "", bad.expenses.length ? `expense lines for ${months(bad.expenses)}` : ""].filter(Boolean);
  if (!parts.length) return null;
  const n = new Set([...bad.sales, ...bad.expenses]).size;
  const text = parts.join(" and ");
  return `${text[0].toUpperCase()}${text.slice(1)} no longer matched the P&L, so they were removed. Upload the General Ledger for ${n > 1 ? "those months" : "that month"} again to bring them back.`;
}

// The company home when the books aren't loaded: one card per module that holds data, from that module's own figures.
// A module never needs another module to show itself here.
import type { ExpensesData } from "@/lib/engine/expenses";
import type { PaymentsData } from "@/lib/engine/payments";
import type { SalesData } from "@/lib/engine/sales";
import type { PeriodTotal } from "@/lib/modules/view";

export interface ModuleCard { key: string; months: number; latest: string; amount: number | null }

function card(key: string, byMonth: Map<string, number> | string[]): ModuleCard | null {
  const months = Array.isArray(byMonth) ? [...new Set(byMonth)].sort() : [...byMonth.keys()].sort();
  if (!months.length) return null;
  const latest = months[months.length - 1];
  return { key, months: months.length, latest, amount: Array.isArray(byMonth) ? null : byMonth.get(latest) ?? 0 };
}
const sum = <T,>(rows: T[], p: (r: T) => string, a: (r: T) => number) => { const m = new Map<string, number>(); for (const r of rows) m.set(p(r), (m.get(p(r)) ?? 0) + a(r)); return m; };

export function moduleOverview(x: { sales: SalesData; expenses: ExpensesData; payments: PaymentsData; stockMonths: string[]; generic: { key: string; periods: PeriodTotal[] }[] }): ModuleCard[] {
  const out: (ModuleCard | null)[] = [
    card("sales", sum(x.sales.customers, (r) => r.p, (r) => r.a)),
    card("expenses", sum(x.expenses.accounts, (r) => r.p, (r) => r.a)),
    card("inventory", x.stockMonths),
    card("payments", sum(x.payments.payments, (r) => r.day.slice(0, 7), (r) => r.amount)),
  ];
  for (const [side, key] of [["receivable", "ar_open"], ["payable", "ap_open"]] as const) {
    const a = x.payments.aged[side];
    if (a) out.push({ key, months: 1, latest: a.asOf.slice(0, 7), amount: a.total.total });
  }
  for (const g of x.generic) out.push(card(g.key, sum(g.periods, (r) => r.period, (r) => r.amount)));
  return out.filter((c): c is ModuleCard => !!c);
}

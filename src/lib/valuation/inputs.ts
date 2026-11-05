import { twelveMonths } from "@/lib/engine/basis";
import { indexMonths, isAnnualColumn } from "@/lib/engine/period";
import { plCalc } from "@/lib/engine/statements";
import { hasBS, hasPL, type MonthData } from "@/lib/engine/types";
import type { SalesData } from "@/lib/engine/sales";
import type { CompanyBundle } from "@/lib/company/types";
import type { ValuationInputs } from "@/lib/engine/valuation";

type Src = Pick<CompanyBundle, "months" | "settings" | "asOf" | "health" | "assumptions">;

/** The latest month with a P&L: the valuation is as at its end. */
export const valuationEnd = (months: MonthData[]) => indexMonths(months).sorted.filter(hasPL).pop()?.period ?? null;

/**
 * The company's own figures for a valuation: the twelve months to the latest month (flows scaled to a year when the
 * books are shorter), the closing balance sheet with its debt-like items, and the signals the quality score reads.
 */
export function valuationInputs(c: Src, sales: SalesData | null, end = valuationEnd(c.months)): ValuationInputs | null {
  if (!end) return null;
  const b = twelveMonths(c.months, end, c.settings.fyStartMonth, c.asOf, c.settings.vatRate);
  const { sorted } = indexMonths(c.months);
  const endMonth = sorted.find((m) => m.period === end)!;
  const P = b.Pa, B = b.B;
  const sub = endMonth.sub ?? {};
  const subOf = endMonth.subOf ?? {};
  const abs = (v: number | undefined) => Math.abs(v ?? 0);
  const lease = abs(sub.lease_liability), dividendsPayable = abs(sub.dividends_payable);
  const vat = c.settings.vatRate ?? 0.14;
  const plMonths = sorted.filter(hasPL);
  // An annual column (audited statements) holds a whole year: it counts as twelve months of history.
  const historyMonths = plMonths.reduce((n, m) => n + (isAnnualColumn(plMonths, m.period, c.settings.fyStartMonth) ? 12 : 1), 0);
  const capex = b.B0 ? Math.max(0, (B.fixed_assets + B.intangibles - b.B0.fixed_assets - b.B0.intangibles) * b.factor + P.da) : null;
  // Monthly revenue over the window, for how even sales are.
  const window = sorted.filter((m) => hasPL(m) && m.period >= b.start && m.period <= end).map((m) => plCalc(m.pl).revenue);
  const mean = window.reduce((s, v) => s + v, 0) / Math.max(1, window.length);
  const sd = Math.sqrt(window.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, window.length));
  const topCustomerShare = sales ? topShare(sales, b.start, end) : null;
  return {
    currency: c.settings.currency, label: b.label, end, covered: b.covered,
    revenue: P.revenue, priorRevenue: b.prior?.P.revenue ?? null,
    ebitda: P.ebitda, da: P.da, netIncome: P.net_income, interest: P.interest_expenses, capex, owc: B.owc, taxRate: c.settings.taxRate,
    cash: B.cash, investments: B.investments, debt: B.debt, lease, endOfService: abs(sub.end_of_service),
    provisions: abs(sub.provisions), dividendsPayable,
    // Sub-classed accounts inside loans can only be leases (or accrued interest): that part is already in the debt.
    leaseInDebt: Math.min(lease, abs(subOf.std) + abs(subOf.ltd)),
    dividendsInAp: Math.min(dividendsPayable, abs(subOf.ap)),
    equity: B.te, liabilities: B.tl, ar: B.ar, inventory: B.inventory, fixedAssets: B.fixed_assets, intangibles: B.intangibles, otherCA: B.other_ca,
    avgDebt: b.avg("debt"),
    quality: {
      months: historyMonths, hasBalanceSheet: hasBS(endMonth) && Object.keys(endMonth.bs).length > 0,
      openChecks: c.health?.failing ?? 0, topCustomerShare, revenueVolatility: mean > 0 ? sd / mean : null,
      // Receivables include VAT, revenue doesn't: VAT is taken out first, as on the KPI page.
      dso: P.revenue > 0 ? B.ar / (1 + vat) / (P.revenue / 365) : null,
    },
    inflation: c.assumptions?.inflation ?? null,
    partMonth: !!c.asOf && c.asOf.slice(0, 7) === end,
  };
}

/** The largest customer's share of sales between two months (null when no customer sales are held). */
export function topShare(sales: SalesData, start: string, end: string): number | null {
  const by = new Map<string, number>();
  for (const r of sales.customers) if (r.p >= start && r.p <= end && r.a > 0) by.set(r.c, (by.get(r.c) ?? 0) + r.a);
  const total = [...by.values()].reduce((s, v) => s + v, 0);
  return total > 0 ? Math.max(...by.values()) / total : null;
}

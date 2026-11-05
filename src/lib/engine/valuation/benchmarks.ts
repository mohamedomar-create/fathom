import type { Range } from "./types";

/**
 * Reference market ranges: low (lower quartile), mid (median) and high (upper quartile) multiples for listed companies in
 * emerging markets, by sector, rounded. They are a starting point for an indicative value, not deal evidence: for a sale,
 * a raise or a legal purpose, replace them with a current source (they can be overridden per company).
 */
export const BENCHMARK_AS_OF = "2026-01";
export const BENCHMARK_SOURCE = "iReport reference ranges for listed emerging-market peers (rounded), January 2026";

export const SECTORS = ["medical", "trading", "retail", "manufacturing", "services", "clinics", "rental", "construction", "technology", "food", "other"] as const;
export type Sector = (typeof SECTORS)[number];

export interface SectorBench { evEbitda: Range; evSales: Range; pe: Range }

const r = (low: number, mid: number, high: number): Range => ({ low, mid, high });
export const BENCHMARKS: Record<Sector, SectorBench> = {
  medical: { evEbitda: r(7, 9.5, 12), evSales: r(0.8, 1.3, 2), pe: r(10, 14, 19) },
  trading: { evEbitda: r(5, 6.5, 8.5), evSales: r(0.3, 0.5, 0.8), pe: r(7, 10, 13) },
  retail: { evEbitda: r(5.5, 7.5, 10), evSales: r(0.4, 0.7, 1.1), pe: r(9, 13, 18) },
  manufacturing: { evEbitda: r(5, 7, 9), evSales: r(0.6, 0.9, 1.4), pe: r(7, 10, 14) },
  services: { evEbitda: r(6, 8, 10.5), evSales: r(0.8, 1.3, 2), pe: r(9, 13, 17) },
  clinics: { evEbitda: r(8, 10.5, 13), evSales: r(1.2, 1.9, 2.8), pe: r(12, 16, 22) },
  rental: { evEbitda: r(5, 6.5, 8), evSales: r(1.2, 1.8, 2.6), pe: r(8, 11, 14) },
  construction: { evEbitda: r(4, 5.5, 7.5), evSales: r(0.3, 0.5, 0.8), pe: r(6, 8, 11) },
  technology: { evEbitda: r(9, 13, 18), evSales: r(1.5, 2.8, 4.5), pe: r(14, 20, 28) },
  food: { evEbitda: r(6.5, 8.5, 11), evSales: r(0.7, 1.1, 1.6), pe: r(10, 14, 18) },
  other: { evEbitda: r(5, 7, 9), evSales: r(0.5, 0.9, 1.4), pe: r(8, 11, 15) },
};

/** Multiples of earnings (EBITDA plus the owner's pay) that small owner-run businesses change hands at. */
export const SDE_MULTIPLE: Range = r(2, 2.8, 3.6);

/** Egypt defaults for the cost of capital (EGP). Checked and changed by finance: the bond yield moves with each auction. */
export const EGYPT = {
  /** Egypt 10-year government bond yield, EGP. */
  riskFree: 0.21,
  /** Equity premium over the local bond (the bond already carries the country's default risk). */
  equityPremium: 0.06,
  beta: 1,
  /** Long-run growth in EGP (nominal: inflation plus a little real growth). */
  longGrowth: 0.08,
  /** Discount for shares that can't be sold on a market, applied to market multiples. */
  privateDiscount: 0.25,
  taxRate: 0.225,
} as const;

/** Size premium by yearly revenue (EGP): smaller companies are riskier to own. */
export function sizePremium(revenue: number): number {
  if (revenue < 50e6) return 0.05;
  if (revenue < 250e6) return 0.04;
  if (revenue < 1e9) return 0.03;
  return 0.02;
}

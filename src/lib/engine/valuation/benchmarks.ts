import type { Range } from "./types";

/**
 * In-house reference ranges (iReport's own estimates, not a third-party dataset): low, central and high multiples for
 * listed companies on the Egyptian exchange and regional peers, by sector, rounded, set for EGP rates of return. They
 * are a starting point for an indicative value, not deal evidence: for a sale, a raise or a legal purpose, replace them
 * with a current source (the central multiple can be overridden per company on the assumptions page).
 */
export const BENCHMARK_AS_OF = "2026-01";
export const BENCHMARK_SOURCE = "iReport in-house estimates (EGX and regional listed peers, rounded), January 2026";

export const SECTORS = ["medical", "trading", "retail", "manufacturing", "services", "clinics", "rental", "construction", "technology", "food", "other"] as const;
export type Sector = (typeof SECTORS)[number];

export interface SectorBench { evEbitda: Range; evSales: Range; pe: Range }

const r = (low: number, mid: number, high: number): Range => ({ low, mid, high });
export const BENCHMARKS: Record<Sector, SectorBench> = {
  medical: { evEbitda: r(5, 6.5, 8), evSales: r(0.6, 0.9, 1.4), pe: r(6, 8, 10.5) },
  trading: { evEbitda: r(3.5, 4.5, 6), evSales: r(0.2, 0.35, 0.55), pe: r(4.5, 6, 8) },
  retail: { evEbitda: r(4, 5.5, 7), evSales: r(0.3, 0.5, 0.8), pe: r(5.5, 7.5, 10) },
  manufacturing: { evEbitda: r(3.5, 5, 6.5), evSales: r(0.4, 0.65, 1), pe: r(4.5, 6, 8) },
  services: { evEbitda: r(4.5, 6, 7.5), evSales: r(0.6, 0.9, 1.4), pe: r(5.5, 7.5, 10) },
  clinics: { evEbitda: r(6, 7.5, 9.5), evSales: r(0.9, 1.4, 2), pe: r(7.5, 10, 13) },
  rental: { evEbitda: r(3.5, 4.5, 6), evSales: r(0.9, 1.3, 1.9), pe: r(5, 6.5, 8.5) },
  construction: { evEbitda: r(3, 4, 5.5), evSales: r(0.2, 0.35, 0.55), pe: r(4, 5, 7) },
  technology: { evEbitda: r(6.5, 9, 12.5), evSales: r(1.1, 2, 3.2), pe: r(9, 12, 17) },
  food: { evEbitda: r(4.5, 6, 8), evSales: r(0.5, 0.8, 1.1), pe: r(6, 8.5, 11) },
  other: { evEbitda: r(3.5, 5, 6.5), evSales: r(0.35, 0.65, 1), pe: r(5, 6.5, 9) },
};

/** Multiples of earnings (EBITDA plus the owner's pay) that small owner-run businesses change hands at. */
export const SDE_MULTIPLE: Range = r(2, 2.8, 3.6);

/** When the Egypt defaults below were last set. */
export const EGYPT_AS_OF = "2026-01";
/** Egypt defaults for the cost of capital (EGP). Checked and changed by finance: the bond yield moves with each auction. */
export const EGYPT = {
  /** Egypt 10-year government bond yield, EGP, today. */
  riskFree: 0.21,
  /** The yield expected once inflation settles (long-run inflation ≈ 7% plus a real return): the discount rate falls to
   * it over the five years and keeps it for the terminal value, so long-run growth and the discount rate rest on the same
   * inflation. */
  longRiskFree: 0.13,
  /** Equity premium over the local bond (the bond already carries the country's default risk). */
  equityPremium: 0.06,
  beta: 1,
  /** Long-run growth in EGP: long-run inflation (≈ 7%, the same one in the long-run yield) plus about 1% real growth. */
  longGrowth: 0.08,
  /** Discount for shares that can't be sold on a market, applied to the equity value of every earnings method. */
  privateDiscount: 0.2,
  taxRate: 0.225,
} as const;

/** Size premium by yearly revenue (EGP): smaller companies are riskier to own. */
export function sizePremium(revenue: number): number {
  if (revenue < 50e6) return 0.05;
  if (revenue < 250e6) return 0.04;
  if (revenue < 1e9) return 0.03;
  return 0.02;
}

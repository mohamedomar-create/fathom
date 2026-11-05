export interface QualityInputs {
  /** Months of history held. */
  months: number;
  hasBalanceSheet: boolean;
  /** Blocking checks not accepted. */
  openChecks: number;
  /** Share of sales from the largest customer (0 to 1), null when unknown. */
  topCustomerShare: number | null;
  /** Spread of monthly revenue (standard deviation ÷ mean). */
  revenueVolatility: number | null;
  /** Days customers take to pay. */
  dso: number | null;
}
export type QualityKey = "history" | "balanceSheet" | "checks" | "concentration" | "volatility" | "collection";
export interface Quality { score: number; grade: "A" | "B" | "C" | "D"; deductions: { key: QualityKey; points: number }[] }

/**
 * How far the books can be relied on, 0 to 100: short history, a missing balance sheet, open checks, one large customer,
 * uneven sales and slow collection each cost points. The score sets how wide every range is (less reliable books, less
 * certain value); the risk of the business itself is in the company premium (companyPremium).
 */
export function qualityScore(q: QualityInputs): Quality {
  const d: { key: QualityKey; points: number }[] = [];
  const take = (key: QualityKey, points: number) => { const p = Math.round(Math.max(0, points)); if (p > 0) d.push({ key, points: p }); };
  take("history", Math.min(30, (24 - q.months) * 1.5));
  if (!q.hasBalanceSheet) take("balanceSheet", 30);
  take("checks", Math.min(20, q.openChecks * 5));
  if (q.topCustomerShare != null) take("concentration", Math.min(20, (q.topCustomerShare * 100 - 20) * 0.6));
  if (q.revenueVolatility != null && q.revenueVolatility > 0.3) take("volatility", 10);
  if (q.dso != null && q.dso > 90) take("collection", 10);
  const score = Math.max(0, 100 - d.reduce((s, x) => s + x.points, 0));
  return { score, grade: score >= 80 ? "A" : score >= 65 ? "B" : score >= 50 ? "C" : "D", deductions: d };
}

/** How much wider a range gets for a quality score: ×1 at 100, ×2 at 0. */
export const widthFor = (score: number) => 1 + (100 - Math.min(100, Math.max(0, score))) / 100;

/**
 * The company-specific risk premium from the business itself (not the books): reliance on one customer (up to 3 points),
 * uneven sales (1 point) and losses (2 points).
 */
export function companyPremium(q: { topCustomerShare: number | null; revenueVolatility: number | null; loss: boolean }): number {
  let p = 0;
  if (q.topCustomerShare != null && q.topCustomerShare > 0.2) p += Math.min(0.03, (q.topCustomerShare - 0.2) * 0.1);
  if (q.revenueVolatility != null && q.revenueVolatility > 0.3) p += 0.01;
  if (q.loss) p += 0.02;
  return p;
}

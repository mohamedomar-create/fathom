import type { Range } from "./types";

/**
 * "What you can ask for": the ways investors and buyers put a higher value on a business than the fair value. Shown as
 * their own labelled band, never blended into the fair value, each with its maths and what a buyer must believe.
 */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const floor0 = (r: Range): Range => ({ low: Math.max(0, r.low), mid: Math.max(0, r.mid), high: Math.max(0, r.high) });
const times = (m: Range, k: number): Range => ({ low: m.low * k, mid: m.mid * k, high: m.high * k });

/** Ask EGP `amount` for `pct` of the company → the value it implies; or, given a value, the share to offer. */
export function dealMaths(d: { amount: number; pct?: number; value?: number }): { amount: number; pct: number; value: number } | null {
  if (!(d.amount > 0)) return null;
  if (d.pct != null) return d.pct > 0 && d.pct <= 1 ? { amount: d.amount, pct: d.pct, value: d.amount / d.pct } : null;
  if (d.value != null && d.value > 0) { const pct = d.amount / d.value; return pct <= 1 ? { amount: d.amount, pct, value: d.value } : null; }
  return null;
}

/** Growth above the sector norm (10% a year) earns a higher multiple: +25% of it for every 10 points, at most double. */
export const GROWTH_NORM = 0.1;
export function growthMultiple(m: Range, growth: number): Range {
  const k = 1 + clamp(((growth - GROWTH_NORM) / 0.1) * 0.25, 0, 1);
  return times(m, k);
}

/** The investor pitch value: profit and sales × growth-adjusted multiples, less net debt, with no private discount. */
export function pitchValue(i: { revenue: number; ebitda: number; growth: number; evEbitda: Range; evSales: Range; netDebt: number }): Range | null {
  const evs: Range[] = [];
  if (i.ebitda > 0) evs.push(times(growthMultiple(i.evEbitda, i.growth), i.ebitda));
  if (i.revenue > 0) evs.push(times(growthMultiple(i.evSales, i.growth), i.revenue));
  if (!evs.length) return null;
  const ev = { low: Math.min(...evs.map((e) => e.low)), mid: evs.reduce((s, e) => s + e.mid, 0) / evs.length, high: Math.max(...evs.map((e) => e.high)) };
  return floor0({ low: ev.low - i.netDebt, mid: ev.mid - i.netDebt, high: ev.high - i.netDebt });
}

/**
 * What a strategic buyer (a competitor, supplier or distributor) could pay: the fair value plus the share it pays of the
 * synergies it gets: costs it saves, and extra sales through its own channels at today's margin, valued at the profit
 * multiple.
 */
export function strategicValue(i: { fair: Range; revenue: number; ebitda: number; multiple: number; savings: number; extraSales: number; share: number }): { synergy: number; value: Range } {
  const costs = Math.max(0, i.revenue - i.ebitda);
  const margin = i.revenue > 0 ? Math.max(0, i.ebitda / i.revenue) : 0;
  const yearly = costs * clamp(i.savings, 0, 0.5) + i.revenue * clamp(i.extraSales, 0, 1) * margin;
  const synergy = yearly * Math.max(0, i.multiple) * clamp(i.share, 0, 1);
  return { synergy, value: { low: i.fair.low + synergy, mid: i.fair.mid + synergy, high: i.fair.high + synergy } };
}

/** The future value (the venture-capital method): the value in year N if growth holds, brought back at the target return. */
export function futureValue(i: { revenue: number; ebitda: number; growth: number; years: number; target: number; evEbitda: Range; evSales: Range; netDebt: number }):
  { exitProfit: number; exitRevenue: number; exitValue: Range; value: Range } | null {
  const n = clamp(Math.round(i.years), 1, 10), g = clamp(i.growth, -0.5, 1), up = (1 + g) ** n;
  const exitProfit = i.ebitda * up, exitRevenue = i.revenue * up;
  const ev = exitProfit > 0 ? times(i.evEbitda, exitProfit) : exitRevenue > 0 ? times(i.evSales, exitRevenue) : null;
  if (!ev) return null;
  const exitValue = floor0({ low: ev.low - i.netDebt, mid: ev.mid - i.netDebt, high: ev.high - i.netDebt });
  const back = (1 + clamp(i.target, 0, 1.5)) ** n;
  return { exitProfit, exitRevenue, exitValue, value: { low: exitValue.low / back, mid: exitValue.mid / back, high: exitValue.high / back } };
}

/** The scorecard method: a typical young company's value × how this one compares on each factor (2.5 of 5 = typical). */
export const SCORECARD_WEIGHTS = { team: 0.3, market: 0.25, product: 0.15, competition: 0.1, channels: 0.1, traction: 0.1 } as const;
export type ScorecardScores = Partial<Record<keyof typeof SCORECARD_WEIGHTS, number>>;
export function scorecard(base: number, s: ScorecardScores): number {
  let k = 0;
  for (const [f, w] of Object.entries(SCORECARD_WEIGHTS)) k += w * (clamp(s[f as keyof ScorecardScores] ?? 2.5, 0, 5) / 2.5);
  return Math.max(0, base) * k;
}

/** The Berkus method: up to a fifth of the cap for each of five things that cut a young company's risk. */
export const BERKUS_CAP = 25e6;
export type BerkusScores = Partial<Record<"idea" | "prototype" | "team" | "partners" | "sales", number>>;
export function berkus(s: BerkusScores, cap = BERKUS_CAP): number {
  return (["idea", "prototype", "team", "partners", "sales"] as const).reduce((v, f) => v + (clamp(s[f] ?? 0, 0, 5) / 5) * (cap / 5), 0);
}

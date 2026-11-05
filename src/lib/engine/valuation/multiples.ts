import type { Range } from "./types";

/**
 * A figure (EBITDA, sales, profit) × a market range of multiples, less a discount for a private company (shares that can't
 * be sold on a market). Null when the figure is zero or a loss: a multiple of a loss means nothing.
 */
export function multipleValue(metric: number, m: Range, discount: number): Range | null {
  if (!(metric > 0)) return null;
  const k = 1 - Math.min(Math.max(discount, 0), 0.9);
  return { low: metric * m.low * k, mid: metric * m.mid * k, high: metric * m.high * k };
}

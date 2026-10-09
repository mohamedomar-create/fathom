export type Quadrant = "EFFICIENCY GAINS" | "QUALITY GROWTH" | "DECLINE" | "STRESS";

/** Quadrant of a point relative to the starting point (blueprint §8.9). y = EBIT, x = Total Operating Investment. */
export function quadrantOf(x: number, y: number, x0: number, y0: number): Quadrant {
  if (y >= y0) return x <= x0 ? "EFFICIENCY GAINS" : "QUALITY GROWTH";
  return x <= x0 ? "DECLINE" : "STRESS";
}

export const QUADRANT_TEXT: Record<Quadrant, string> = {
  "EFFICIENCY GAINS": "More profit from less capital — the best place to be.",
  "QUALITY GROWTH": "Profit is growing along with the capital invested.",
  DECLINE: "The business is shrinking: less capital and less profit.",
  STRESS: "More capital is tied up but profit has fallen — watch working capital and fixed assets.",
};

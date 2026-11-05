export interface Adjustment {
  key: "oneoff" | "owner" | "disposal" | "fx" | "related" | "other";
  label: string;
  /** Added to EBITDA (an expense that won't recur is positive; a cost that is missing, like a market salary, negative). */
  amount: number;
}

/** Earnings as they would be in a normal year: the adjustments go into EBITDA, and after tax into net income. */
export function normalise(base: { ebitda: number; netIncome: number; taxRate: number }, adj: Adjustment[]) {
  const total = adj.reduce((s, a) => s + a.amount, 0);
  return { ebitda: base.ebitda + total, netIncome: base.netIncome + total * (1 - base.taxRate), total };
}

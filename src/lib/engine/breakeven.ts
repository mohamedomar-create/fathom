import { div } from "./format";
import type { PLCalc } from "./types";

export interface Breakeven {
  ok: true;
  revenue: number; totalCosts: number; variableCosts: number; fixedCosts: number;
  vcr: number; bep: number; mos: number; mosPct: number; operatingProfit: number;
}
export type BreakevenResult = Breakeven | { ok: false; reason: "no_revenue" | "variable_costs_exceed_revenue" };

/** Breakeven analysis (blueprint §8.5). */
export function breakeven(P: PLCalc): BreakevenResult {
  if (!P.revenue) return { ok: false, reason: "no_revenue" };
  const vcr = div(P.variable_costs, P.revenue)!;
  if (vcr >= 1) return { ok: false, reason: "variable_costs_exceed_revenue" };
  const bep = P.fixed_costs / (1 - vcr);
  const mos = P.revenue - bep;
  return {
    ok: true, revenue: P.revenue, totalCosts: P.cos + P.expenses, variableCosts: P.variable_costs, fixedCosts: P.fixed_costs,
    vcr, bep, mos, mosPct: (mos / P.revenue) * 100, operatingProfit: P.operating_profit,
  };
}

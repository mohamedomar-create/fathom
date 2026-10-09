import type { PLCalc } from "./types";

export type GoalKpi = "profit_ratio" | "opm" | "gpm";
export type LeverKey = "price" | "volume" | "cos_variable" | "exp_fixed" | "exp_variable" | "other_expenses" | "other_income";
export const GOAL_KPIS: { key: GoalKpi; name: string; numerator: "ebit" | "operating_profit" | "gross_profit" }[] = [
  { key: "profit_ratio", name: "Profitability Ratio", numerator: "ebit" },
  { key: "opm", name: "Operating Profit Margin", numerator: "operating_profit" },
  { key: "gpm", name: "Gross Profit Margin", numerator: "gross_profit" },
];
export const LEVERS: { key: LeverKey; name: string; band: "HIGH SENSITIVITY" | "MEDIUM SENSITIVITY" | "LOW SENSITIVITY"; colour: string; info?: string }[] = [
  { key: "price", name: "Price", band: "HIGH SENSITIVITY", colour: "#3B8FD0", info: "Raise selling prices; volumes and costs stay the same." },
  { key: "volume", name: "Volume", band: "HIGH SENSITIVITY", colour: "#B06AB3", info: "Sell more units at the same price; variable costs grow with volume." },
  { key: "cos_variable", name: "Variable COS", band: "HIGH SENSITIVITY", colour: "#2E9C8F" },
  { key: "exp_fixed", name: "Fixed Expenses", band: "HIGH SENSITIVITY", colour: "#7CB46B" },
  { key: "exp_variable", name: "Variable Expenses", band: "MEDIUM SENSITIVITY", colour: "#C58A1B" },
  { key: "other_expenses", name: "Other Expenses", band: "MEDIUM SENSITIVITY", colour: "#B5487A" },
  { key: "other_income", name: "Other Income", band: "LOW SENSITIVITY", colour: "#5A6ACF" },
];

/** Linear effect of a +100% change of each lever on (numerator, revenue). */
function coeffs(P: PLCalc, kpi: GoalKpi, lever: LeverKey): { a: number; b: number } {
  const inGP = kpi === "gpm";
  const inOP = kpi === "opm";
  switch (lever) {
    case "price": return { a: P.revenue, b: P.revenue };
    case "volume": return { a: P.revenue - P.cos_variable - (inGP ? 0 : P.exp_variable), b: P.revenue };
    case "cos_variable": return { a: -P.cos_variable, b: 0 };
    case "exp_fixed": return { a: inGP ? 0 : -P.exp_fixed, b: 0 };
    case "exp_variable": return { a: inGP ? 0 : -P.exp_variable, b: 0 };
    case "other_expenses": return { a: inGP || inOP ? 0 : -P.other_expenses, b: 0 };
    case "other_income": return { a: inGP || inOP ? 0 : P.other_income, b: 0 };
  }
}

const numer = (P: PLCalc, kpi: GoalKpi) => P[GOAL_KPIS.find((g) => g.key === kpi)!.numerator];

export function currentRatio(P: PLCalc, kpi: GoalKpi): number | null {
  return P.revenue ? (numer(P, kpi) / P.revenue) * 100 : null;
}

/** % change in one lever alone that reaches the goal (others unchanged). goal is a percentage, e.g. 15. */
export function leverNeeded(P: PLCalc, kpi: GoalKpi, goalPct: number, lever: LeverKey): number | null {
  if (!P.revenue) return null;
  const g = goalPct / 100;
  const { a, b } = coeffs(P, kpi, lever);
  const denom = a - g * b;
  if (!denom) return null;
  return ((g * P.revenue - numer(P, kpi)) / denom) * 100;
}

/** Apply several lever changes together (each in %) and return the resulting ratio. */
export function applyChanges(P: PLCalc, kpi: GoalKpi, changes: Partial<Record<LeverKey, number>>): number | null {
  const c = (k: LeverKey) => (changes[k] ?? 0) / 100;
  const vol = 1 + c("volume");
  const R1 = P.revenue * (1 + c("price")) * vol;
  const vcos1 = P.cos_variable * vol * (1 + c("cos_variable"));
  const vexp1 = P.exp_variable * vol * (1 + c("exp_variable"));
  const fexp1 = P.exp_fixed * (1 + c("exp_fixed"));
  const oe1 = P.other_expenses * (1 + c("other_expenses"));
  const oi1 = P.other_income * (1 + c("other_income"));
  const gp = P.gross_profit + (R1 - P.revenue) - (vcos1 - P.cos_variable);
  const op = gp - (P.expenses + (vexp1 - P.exp_variable) + (fexp1 - P.exp_fixed));
  const ebit = op + oi1 - oe1;
  if (!R1) return null;
  const n = kpi === "gpm" ? gp : kpi === "opm" ? op : ebit;
  return (n / R1) * 100;
}

export function goalseekTable(P: PLCalc, kpi: GoalKpi, goalPct: number) {
  return LEVERS.map((l) => ({ ...l, needed: leverNeeded(P, kpi, goalPct, l.key) }));
}

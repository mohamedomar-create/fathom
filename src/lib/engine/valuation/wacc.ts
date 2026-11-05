export interface CapitalInputs {
  /** Local-currency 10-year government bond yield (it carries the country's default risk). */
  riskFree: number;
  beta: number;
  /** Equity risk premium on top of the bond yield. */
  equityPremium: number;
  sizePremium: number;
  /** Company-specific premium (from the quality of the books, concentration and the like). */
  specificPremium: number;
  /** Pre-tax cost of the company's debt. */
  costOfDebt: number;
  taxRate: number;
  /** Debt ÷ (debt + equity), 0 to 1. */
  debtWeight: number;
}

export interface CostOfCapital { costOfEquity: number; afterTaxDebt: number; wacc: number }

/** Cost of equity by build-up (bond yield + beta × premium + size + company), and the weighted average cost of capital. */
export function costOfCapital(i: CapitalInputs): CostOfCapital {
  const costOfEquity = i.riskFree + i.beta * i.equityPremium + i.sizePremium + i.specificPremium;
  const afterTaxDebt = i.costOfDebt * (1 - i.taxRate);
  const w = Math.min(Math.max(i.debtWeight, 0), 0.9);
  return { costOfEquity, afterTaxDebt, wacc: (1 - w) * costOfEquity + w * afterTaxDebt };
}

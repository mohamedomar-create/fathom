export const PL_KEYS = [
  "revenue", "cos_variable", "cos_fixed", "cos_depreciation", "exp_variable", "exp_fixed", "exp_depreciation",
  "other_income", "other_expenses", "interest_income", "interest_expenses", "tax_expenses", "adjustments", "dividends",
] as const;
export const BS_KEYS = [
  "cash", "ar", "inventory", "wip", "other_ca", "fixed_assets", "intangibles", "investments",
  "std", "ap", "tax_liab", "other_cl", "ltd", "other_ncl", "retained_earnings", "other_equity",
] as const;

export type PLKey = (typeof PL_KEYS)[number];
export type BSKey = (typeof BS_KEYS)[number];
export type ClassKey = PLKey | BSKey;
export type PLInput = Partial<Record<PLKey, number>>;
export type BSInput = Partial<Record<BSKey, number>>;

/** One month of mapped data. period = "YYYY-MM". P&L = movements for the month; BS = closing balances. */
export interface MonthData {
  period: string;
  pl: PLInput;
  bs: BSInput;
}

export type PLCalc = Record<PLKey, number> & {
  cos: number; expenses: number; gross_profit: number; operating_profit: number; ebit: number; ebt: number;
  eat: number; net_income: number; retained_income: number; da: number; ebitda: number; net_interest: number;
  variable_costs: number; fixed_costs: number;
};

export type BSCalc = Record<BSKey, number> & {
  tca: number; tnca: number; ta: number; tcl: number; tncl: number; tl: number; te: number; tle: number;
  imbalance: number; debt: number; owc: number; tic: number; toi: number;
};

export type PeriodType = "month" | "quarter" | "year";
export type Comparison = "target" | "prior" | "ly";
export type Importance = "Critical" | "High" | "Medium" | "Low";

export interface CompanySettings {
  currency: string;
  fyStartMonth: number; // 1..12
  taxRate: number; // 0.225
  targets?: Record<string, number | null | undefined>;
  importance?: Record<string, Importance>;
  activeKpis?: string[];
}

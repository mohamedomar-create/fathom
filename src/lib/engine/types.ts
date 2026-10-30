export const PL_KEYS = [
  "revenue", "cos_variable", "cos_fixed", "cos_depreciation", "exp_variable", "exp_fixed", "exp_depreciation",
  "other_income", "other_expenses", "interest_income", "interest_expenses", "tax_expenses", "adjustments", "dividends",
] as const;
export const BS_KEYS = [
  "cash", "ar", "inventory", "wip", "other_ca", "fixed_assets", "intangibles", "investments",
  "std", "ap", "tax_liab", "other_cl", "ltd", "other_ncl", "retained_earnings", "other_equity",
] as const;

/**
 * Optional sub-classes under the 30 classes: they never change an account's class or any figure built from classes, and
 * only let the cash flow statement follow IAS 7 (interest, dividends and income tax paid; disposals; leases; non-cash
 * movements). A gain is positive, a loss negative (disposal_gain, fx_unrealised).
 */
export const SUB_KEYS = [
  "interest_payable", "dividends_payable", "income_tax_payable", "provisions", "end_of_service", "deferred_tax",
  "lease_liability", "rou_asset", "rou_depreciation", "disposal_gain", "fx_unrealised",
] as const;
export type SubKey = (typeof SUB_KEYS)[number];

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
  /** Which statements were loaded for the month. Absent means both (hand-built data, the demo). */
  has?: { pl: boolean; bs: boolean };
  /** Amounts held in sub-classed accounts (absent when the company has none). */
  sub?: Partial<Record<SubKey, number>>;
  /** How much of each class sits in sub-classed accounts (natural sign), so a class's change can be split. */
  subOf?: Partial<Record<ClassKey, number>>;
}

/** The month's P&L was loaded (a month holding only a balance sheet, such as the opening balance, has none). */
export const hasPL = (m: Pick<MonthData, "has">) => !m.has || m.has.pl;
/** The month's balance sheet was loaded (a P&L uploaded on its own has none). */
export const hasBS = (m: Pick<MonthData, "has">) => !m.has || m.has.bs;

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
  /** VAT rate for debtor and creditor days (0.14 when not set). */
  vatRate?: number;
  targets?: Record<string, number | null | undefined>;
  importance?: Record<string, Importance>;
  activeKpis?: string[];
}

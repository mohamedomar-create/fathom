import { BS_KEYS, PL_KEYS, type ClassKey } from "@/lib/engine";

/** The 30 iReport classes, as shown to people. */
export const CLASS_LABEL: Record<ClassKey, string> = {
  revenue: "Revenue", cos_variable: "Cost of Sales · Variable", cos_fixed: "Cost of Sales · Fixed", cos_depreciation: "Cost of Sales · Depreciation",
  exp_variable: "Expenses · Variable", exp_fixed: "Expenses · Fixed", exp_depreciation: "Expenses · Depreciation & Amortisation",
  other_income: "Other Income", other_expenses: "Other Expenses", interest_income: "Interest Income", interest_expenses: "Interest Expenses",
  tax_expenses: "Tax Expenses", adjustments: "Adjustments", dividends: "Dividends",
  cash: "Cash & Equivalents", ar: "Accounts Receivable", inventory: "Inventory", wip: "Work In Progress", other_ca: "Other Current Assets",
  fixed_assets: "Fixed Assets", intangibles: "Intangible Assets", investments: "Investments / Other Non-Current Assets",
  std: "Short Term Debt", ap: "Accounts Payable", tax_liab: "Tax Liability", other_cl: "Other Current Liabilities",
  ltd: "Long Term Debt", other_ncl: "Other Non-Current Liabilities", retained_earnings: "Retained Earnings", other_equity: "Other Equity",
};
export const CLASS_OPTIONS = [...PL_KEYS, ...BS_KEYS] as ClassKey[];

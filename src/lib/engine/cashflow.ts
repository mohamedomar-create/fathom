import type { BSCalc, PLCalc } from "./types";

export type WaterfallSign = "ADD" | "LESS" | "TOTAL";
export interface WaterfallRow {
  label: string;
  sign: WaterfallSign;
  value: number;
  info?: string;
}
export interface Waterfall {
  rows: WaterfallRow[];
  ocf: number; fcf: number; ncf: number;
  dcash: number; ddebt: number; cash0: number; cash1: number; debt0: number; debt1: number;
}

/** Direct-style cash-flow waterfall built from P&L + balance-sheet movements (blueprint §8.6). */
export function cashWaterfall(P: PLCalc, B: BSCalc, B0: BSCalc, t: number): Waterfall {
  const d = (k: keyof BSCalc) => (B[k] as number) - (B0[k] as number);
  const cashTax = P.tax_expenses - d("tax_liab") + t * P.net_interest;
  const rows: WaterfallRow[] = [];
  const add = (label: string, sign: WaterfallSign, value: number, info?: string) => rows.push({ label, sign, value, info });
  add("Revenue", "ADD", P.revenue);
  add("Cost of Sales", "LESS", -(P.cos - P.cos_depreciation), "Cost of sales excluding depreciation (a non-cash cost).");
  add("Expenses", "LESS", -(P.expenses - P.exp_depreciation + P.other_expenses), "Operating and other expenses excluding depreciation & amortisation.");
  add("Other Income", "ADD", P.other_income);
  add("Cash Tax Paid", "LESS", -cashTax, "Tax expense less the increase in tax liabilities, plus the tax shield on net interest (shown again after tax under financing).");
  add("Change in Accounts Payable", "ADD", d("ap"));
  add("Change in Other Current Liabilities", "ADD", d("other_cl"));
  add("Change in Accounts Receivable", "LESS", -d("ar"));
  add("Change in Inventory", "LESS", -d("inventory"));
  add("Change in Work In Progress", "LESS", -d("wip"));
  add("Change in Other Current Assets", "LESS", -d("other_ca"));
  const ocf = rows.reduce((s, r) => s + r.value, 0);
  add("OPERATING CASH FLOW", "TOTAL", ocf);
  const inv: WaterfallRow[] = [
    { label: "Change in Fixed Assets (ex. Depn & Amortisation)", sign: "LESS", value: -(d("fixed_assets") + P.da) },
    { label: "Change in Intangible Assets", sign: "LESS", value: -d("intangibles") },
    { label: "Change in Investments or Other Non-Current Assets", sign: "LESS", value: -d("investments") },
  ];
  rows.push(...inv);
  const fcf = ocf + inv.reduce((s, r) => s + r.value, 0);
  add("FREE CASH FLOW", "TOTAL", fcf);
  const eqChange = d("retained_earnings") + d("other_equity") - P.retained_income;
  const fin: WaterfallRow[] = [
    { label: "Net Interest (after tax)", sign: "LESS", value: -P.net_interest * (1 - t) },
    { label: "Change in Other Non-Current Liabilities", sign: "ADD", value: d("other_ncl") },
    { label: "Dividends", sign: "LESS", value: -P.dividends },
    { label: "Change in Retained Earnings and Other Equity", sign: "ADD", value: eqChange },
  ];
  rows.push(...fin);
  const ncfPre = fcf + fin.reduce((s, r) => s + r.value, 0);
  const target = d("cash") - d("std") - d("ltd");
  const unbal = target - ncfPre + P.adjustments;
  add("Change in unbalanced Balance Sheet", "ADD", unbal, "Any movement that does not reconcile because the balance sheet is out of balance.");
  add("Adjustments", "LESS", -P.adjustments);
  const ncf = ncfPre + unbal - P.adjustments;
  add("NET CASH FLOW", "TOTAL", ncf);
  return {
    rows, ocf, fcf, ncf,
    dcash: d("cash"), ddebt: d("std") + d("ltd"),
    cash0: B0.cash, cash1: B.cash, debt0: B0.std + B0.ltd, debt1: B.std + B.ltd,
  };
}

export interface StatementLine { label: string; value: number; total?: boolean; heading?: boolean }

/** Indirect cash-flow statement (blueprint §8.7). Reconciles to the change in cash. */
export function cashFlowStatement(P: PLCalc, B: BSCalc, B0: BSCalc): { lines: StatementLine[]; cfo: number; cfi: number; cff: number; dcash: number } {
  const d = (k: keyof BSCalc) => (B[k] as number) - (B0[k] as number);
  const op: [string, number][] = [
    ["Net Income", P.net_income],
    ["Depreciation & Amortisation", P.da],
    ["Change in Accounts Payable", d("ap")],
    ["Change in Other Current Liabilities", d("other_cl")],
    ["Change in Tax Liability", d("tax_liab")],
    ["Change in Accounts Receivable", -d("ar")],
    ["Change in Inventory", -d("inventory")],
    ["Change in Work In Progress", -d("wip")],
    ["Change in Other Current Assets", -d("other_ca")],
  ];
  const cfo = op.reduce((s, [, v]) => s + v, 0);
  const iv: [string, number][] = [
    ["Purchase / Sale of Fixed Assets", -(d("fixed_assets") + P.da)],
    ["Change in Intangible Assets", -d("intangibles")],
    ["Change in Investments / Other Non-Current Assets", -d("investments")],
  ];
  const cfi = iv.reduce((s, [, v]) => s + v, 0);
  const fn: [string, number][] = [
    ["Dividends Paid", -P.dividends],
    ["Change in Other Equity", d("other_equity")],
    ["Change in Earnings not attributable to Retained Income", d("retained_earnings") - P.retained_income],
    ["Change in Short Term Debt", d("std")],
    ["Change in Long Term Debt", d("ltd")],
    ["Change in Other Non-Current Liabilities", d("other_ncl")],
  ];
  const pre = cfo + cfi + fn.reduce((s, [, v]) => s + v, 0);
  const unbal = d("cash") - pre;
  if (Math.abs(unbal) > 0.5) fn.push(["Change in unbalanced Balance Sheet", unbal]);
  const cff = fn.reduce((s, [, v]) => s + v, 0);
  const lines: StatementLine[] = [
    { label: "OPERATING ACTIVITIES", value: 0, heading: true },
    ...op.map(([label, value]) => ({ label, value })),
    { label: "Cash Flow from Operating Activities", value: cfo, total: true },
    { label: "INVESTING ACTIVITIES", value: 0, heading: true },
    ...iv.map(([label, value]) => ({ label, value })),
    { label: "Cash Flow from Investing Activities", value: cfi, total: true },
    { label: "FINANCING ACTIVITIES", value: 0, heading: true },
    ...fn.map(([label, value]) => ({ label, value })),
    { label: "Cash Flow from Financing Activities", value: cff, total: true },
    { label: "Change in Cash & Equivalents", value: cfo + cfi + cff, total: true },
    { label: "Opening Balance", value: B0.cash },
    { label: "Closing Balance", value: B0.cash + cfo + cfi + cff, total: true },
  ];
  return { lines, cfo, cfi, cff, dcash: d("cash") };
}

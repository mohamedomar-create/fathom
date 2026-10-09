import { bsCalc, cashWaterfall, computeKpis, KPI_DEFS, plCalc, type BSCalc, type MonthData, type PLCalc, type Unit } from "@/lib/engine";
import type { AccountLine } from "@/lib/company/types";

export interface MetricDef { key: string; label: string; group: "KPIs" | "Profit & Loss" | "Balance Sheet" | "Cash Flow" | "Chart of Accounts"; unit: Unit }
export interface MonthCalc { period: string; P: PLCalc; B: BSCalc; K: Record<string, number | null>; W: { ocf: number; fcf: number; ncf: number } | null }

export function monthCalcs(months: MonthData[], taxRate: number): MonthCalc[] {
  const s = [...months].sort((a, b) => a.period.localeCompare(b.period));
  return s.map((m, i) => {
    const P = plCalc(m.pl), B = bsCalc(m.bs);
    const B0 = i > 0 ? bsCalc(s[i - 1].bs) : null;
    const Pp = i > 0 ? plCalc(s[i - 1].pl) : null;
    const W = B0 ? cashWaterfall(P, B, B0, taxRate) : null;
    const [y, mo] = m.period.split("-").map(Number);
    const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return { period: m.period, P, B, K: computeKpis({ P, B, B0, Pprev: Pp, days, ocf: W?.ocf ?? null }), W: W && { ocf: W.ocf, fcf: W.fcf, ncf: W.ncf } };
  });
}

const PL_METRICS: [string, string][] = [
  ["revenue", "Revenue"], ["cos_fixed", "Fixed COS"], ["cos_variable", "Variable COS"], ["cos_depreciation", "COS Depreciation"], ["cos", "Cost of Sales"],
  ["gross_profit", "Gross Profit"], ["exp_fixed", "Fixed Expenses"], ["exp_variable", "Variable Expenses"], ["exp_depreciation", "Depreciation & Amortisation"],
  ["expenses", "Expenses"], ["operating_profit", "Operating Profit"], ["other_income", "Other Income"], ["other_expenses", "Other Expenses"],
  ["ebit", "Earnings Before Interest & Tax"], ["interest_income", "Interest Income"], ["interest_expenses", "Interest Expenses"], ["ebt", "Earnings Before Tax"],
  ["tax_expenses", "Tax Expenses"], ["eat", "Earnings After Tax"], ["net_income", "Net Income"], ["retained_income", "Retained Income"],
  ["ebitda", "EBITDA"], ["net_interest", "Net Interest"],
];
const BS_METRICS: [string, string][] = [
  ["cash", "Cash & Equivalents"], ["ar", "Accounts Receivable"], ["inventory", "Inventory"], ["wip", "Work In Progress"], ["other_ca", "Other Current Assets"],
  ["tca", "Total Current Assets"], ["fixed_assets", "Fixed Assets"], ["tnca", "Total Non-Current Assets"], ["ta", "Total Assets"],
  ["std", "Short Term Debt"], ["ap", "Accounts Payable"], ["tax_liab", "Tax Liability"], ["other_cl", "Other Current Liabilities"], ["tcl", "Total Current Liabilities"],
  ["ltd", "Long Term Debt"], ["tncl", "Total Non-Current Liabilities"], ["tl", "Total Liabilities"], ["te", "Total Equity"], ["debt", "Total Debt"], ["owc", "Operating Working Capital"],
];

export function metricCatalogue(accounts: AccountLine[]): MetricDef[] {
  return [
    ...KPI_DEFS.map((d) => ({ key: `k:${d.key}`, label: d.name, group: "KPIs" as const, unit: d.unit })),
    ...PL_METRICS.map(([k, l]) => ({ key: `p:${k}`, label: l, group: "Profit & Loss" as const, unit: "cur" as Unit })),
    ...BS_METRICS.map(([k, l]) => ({ key: `b:${k}`, label: l, group: "Balance Sheet" as const, unit: "cur" as Unit })),
    { key: "w:ocf", label: "Operating Cash Flow", group: "Cash Flow", unit: "cur" },
    { key: "w:fcf", label: "Free Cash Flow", group: "Cash Flow", unit: "cur" },
    { key: "w:ncf", label: "Net Cash Flow", group: "Cash Flow", unit: "cur" },
    ...accounts.map((a) => ({ key: `a:${a.id}`, label: `${a.code} ${a.name}`, group: "Chart of Accounts" as const, unit: "cur" as Unit })),
  ];
}

export function metricValue(key: string, m: MonthCalc, accounts: AccountLine[]): number | null {
  const [t, k] = [key.slice(0, 1), key.slice(2)];
  if (t === "k") return m.K[k] ?? null;
  if (t === "p") return (m.P as unknown as Record<string, number>)[k] ?? null;
  if (t === "b") return (m.B as unknown as Record<string, number>)[k] ?? null;
  if (t === "w") return m.W ? m.W[k as "ocf"] : null;
  if (t === "a") return accounts.find((a) => a.id === k)?.amounts[m.period] ?? null;
  return null;
}

export const PREDEFINED: { label: string; keys: string[] }[] = [
  { label: "Income", keys: ["p:revenue", "p:other_income"] },
  { label: "COS & Expense", keys: ["p:cos", "p:expenses"] },
  { label: "Profit", keys: ["p:gross_profit", "p:operating_profit", "p:ebit", "p:net_income"] },
  { label: "Asset", keys: ["b:tca", "b:tnca", "b:ta"] },
  { label: "Equity", keys: ["b:te", "b:tl"] },
  { label: "Working Capital", keys: ["b:ar", "b:inventory", "b:ap"] },
  { label: "Cash Conversion", keys: ["k:ar_days", "k:inv_days", "k:ap_days"] },
  { label: "Liquidity", keys: ["k:current", "k:quick"] },
  { label: "Cash Position", keys: ["b:cash", "b:debt"] },
  { label: "Cash Flow", keys: ["w:ocf", "w:fcf", "w:ncf"] },
  { label: "Profit vs Cash Flow", keys: ["p:ebit", "w:ocf"] },
];

import { div, money, num, pct, type Unit } from "./format";
import type { BSCalc, Importance, PLCalc } from "./types";

export type KpiCategory =
  | "Profitability" | "Activity" | "Efficiency" | "Asset Usage" | "Liquidity" | "Coverage" | "Gearing" | "Cash Flow" | "Growth";

export interface KpiDef {
  key: string;
  name: string;
  category: KpiCategory;
  unit: Unit;
  direction: "up" | "down";
  target: number | null;
  importance: Importance;
  formula: string;
  about: string;
  /** Part of the reference engine's default 24 (used for parity tests). */
  core?: boolean;
  /** Active by default for new companies. */
  defaultActive: boolean;
}

const d = (
  key: string, name: string, category: KpiCategory, unit: Unit, direction: "up" | "down", target: number | null,
  importance: Importance, formula: string, about: string, opts: { core?: boolean; active?: boolean } = {},
): KpiDef => ({ key, name, category, unit, direction, target, importance, formula, about, core: opts.core ?? true, defaultActive: opts.active ?? true });

export const KPI_DEFS: KpiDef[] = [
  d("total_revenue", "Total Revenue", "Profitability", "cur", "up", null, "Critical", "Total Revenue = Sum of all revenue accounts", "The value of sales recognised in the period."),
  d("gpm", "Gross Profit Margin", "Profitability", "%", "up", 35, "Medium", "Gross Profit Margin = Gross Profit ÷ Revenue × 100", "A measure of the proportion of revenue that is left after deducting all costs directly related to the sales."),
  d("opm", "Operating Profit Margin", "Profitability", "%", "up", 15, "High", "Operating Profit Margin = Operating Profit ÷ Revenue × 100", "The share of revenue left after cost of sales and operating expenses."),
  d("profit_ratio", "Profitability Ratio", "Profitability", "%", "up", 10, "Critical", "Profitability Ratio = EBIT ÷ Revenue × 100", "Earnings before interest and tax as a share of revenue: how much of each sale becomes operating profit."),
  d("npat", "Net Profit After Tax Margin", "Profitability", "%", "up", 7, "Medium", "Net Profit After Tax Margin = Earnings After Tax ÷ Revenue × 100", "What is left for the owners from each sale after every cost, interest and tax."),
  d("activity", "Activity Ratio", "Activity", "times", "up", 2, "Critical", "Activity Ratio = Annualised Revenue ÷ Total Invested Capital", "How many times a year the capital invested in the business is turned into sales."),
  d("ar_days", "Accounts Receivable Days", "Activity", "days", "down", 45, "Medium", "Accounts Receivable Days = Accounts Receivable × Days ÷ Revenue", "How long customers take, on average, to pay."),
  d("inv_days", "Inventory Days", "Activity", "days", "down", 60, "Medium", "Inventory Days = Inventory × Days ÷ Cost of Sales", "How long stock sits before it is sold."),
  d("ap_days", "Accounts Payable Days", "Activity", "days", "up", 45, "Medium", "Accounts Payable Days = Accounts Payable × Days ÷ Cost of Sales", "How long the business takes, on average, to pay its suppliers."),
  d("roe", "Return on Equity", "Efficiency", "%", "up", 15, "Critical", "Return on Equity = Annualised Net Income ÷ Opening Total Equity × 100", "The annual return the owners earn on the equity they have in the business."),
  d("roce", "Return on Capital Employed", "Efficiency", "%", "up", 12.5, "Critical", "Return on Capital Employed = Annualised EBIT ÷ Total Invested Capital × 100", "Operating return on all capital invested, from owners and lenders."),
  d("gmroi", "Gross Margin Return on Inventory", "Efficiency", "%", "up", 150, "Low", "GMROI = Annualised Gross Profit ÷ Average Inventory × 100", "Gross profit earned for each unit of money tied up in stock."),
  d("asset_turn", "Asset Turnover", "Asset Usage", "times", "up", 2, "Medium", "Asset Turnover = Annualised Revenue ÷ Total Assets", "How much revenue each unit of assets generates in a year."),
  d("wca", "Working Capital Absorption", "Asset Usage", "%", "down", 25, "Low", "Working Capital Absorption = Operating Working Capital ÷ Annualised Revenue × 100", "How much working capital (receivables + stock − payables) each unit of annual sales needs."),
  d("current", "Current Ratio", "Liquidity", "ratio", "up", 2, "Medium", "Current Ratio = Total Current Assets ÷ Total Current Liabilities", "Short-term assets available to cover short-term bills."),
  d("quick", "Quick Ratio", "Liquidity", "ratio", "up", 1, "Medium", "Quick Ratio = (Cash & Equivalents + Accounts Receivable) ÷ Total Current Liabilities", "Cash and receivables available to cover short-term bills, without relying on stock."),
  d("int_cover", "Interest Cover", "Coverage", "times", "up", 3, "Medium", "Interest Cover = EBIT ÷ (Interest Expenses − Interest Income)", "How many times operating profit covers net interest."),
  d("cash", "Cash on Hand", "Cash Flow", "cur", "up", null, "Medium", "Cash on Hand = Closing Cash & Equivalents", "Cash and bank balances at the end of the period."),
  d("cf_margin", "Cash Flow Margin", "Cash Flow", "%", "up", 10, "Low", "Cash Flow Margin = Operating Cash Flow ÷ Revenue × 100", "How much of each sale turns into operating cash."),
  d("nvcf", "Net Variable Cash Flow", "Cash Flow", "%", "up", 0, "Medium", "Net Variable Cash Flow = (Ann. Revenue − Ann. Variable COS − Ann. Variable Expenses − Operating Working Capital) ÷ Ann. Revenue × 100", "Cash generated by sales after variable costs and the working capital they need.", { core: false }),
  d("rev_growth", "Revenue Growth", "Growth", "%", "up", 2, "Critical", "Revenue Growth = (Revenue − Prior Revenue) ÷ Prior Revenue × 100", "Change in revenue against the prior period."),
  d("gp_growth", "Gross Profit Growth", "Growth", "%", "up", 2, "Medium", "Gross Profit Growth = (Gross Profit − Prior Gross Profit) ÷ Prior Gross Profit × 100", "Change in gross profit against the prior period."),
  d("ebit_growth", "EBIT Growth", "Growth", "%", "up", 2, "High", "EBIT Growth = (EBIT − Prior EBIT) ÷ |Prior EBIT| × 100", "Change in operating profit against the prior period."),
  d("asset_change", "Asset Change", "Growth", "%", "up", 1, "Low", "Asset Change = (Total Assets − Opening Total Assets) ÷ Opening Total Assets × 100", "Growth in the asset base over the period."),
  d("equity_change", "Equity Change", "Growth", "%", "up", 1, "Low", "Equity Change = (Total Equity − Opening Total Equity) ÷ Opening Total Equity × 100", "Growth in owners' equity over the period."),
  // Library KPIs (off by default)
  d("ebitda_margin", "EBITDA Margin", "Profitability", "%", "up", 15, "Medium", "EBITDA Margin = EBITDA ÷ Revenue × 100", "Operating profit before depreciation and amortisation, as a share of revenue.", { core: false, active: false }),
  d("exp_ratio", "Expense-to-Revenue Ratio", "Profitability", "%", "down", 30, "Medium", "Expense-to-Revenue Ratio = Expenses ÷ Revenue × 100", "Operating expenses as a share of revenue.", { core: false, active: false }),
  d("mos", "Breakeven Margin of Safety", "Profitability", "%", "up", 20, "High", "Margin of Safety = (Revenue − Breakeven Revenue) ÷ Revenue × 100", "How far revenue can fall before the business makes an operating loss.", { core: false, active: false }),
  d("ccc", "Cash Conversion Cycle", "Activity", "days", "down", 60, "Medium", "Cash Conversion Cycle = AR Days + Inventory Days + WIP Days − AP Days", "Days the business funds its own trading cycle before cash comes back.", { core: false, active: false }),
  d("debt_equity", "Debt to Equity", "Gearing", "%", "down", 100, "Medium", "Debt to Equity = Total Debt ÷ Total Equity × 100", "Borrowing relative to owners' capital.", { core: false, active: false }),
];

export const KPI_BY_KEY = Object.fromEntries(KPI_DEFS.map((k) => [k.key, k]));
export const CAT_ORDER: KpiCategory[] = ["Profitability", "Activity", "Efficiency", "Asset Usage", "Liquidity", "Coverage", "Gearing", "Cash Flow", "Growth"];
export const CAT_COL: Record<KpiCategory, string> = {
  Profitability: "#3B7DD8", Activity: "#7B4FA0", Efficiency: "#2E9C8F", "Asset Usage": "#C58A1B", Liquidity: "#5A6ACF",
  Coverage: "#B5487A", Gearing: "#6B7A8F", "Cash Flow": "#3E8E55", Growth: "#8A6D3B",
};

const x100 = (v: number | null) => (v === null ? null : v * 100);
const growth = (a: number, b: number | null | undefined) => (b === null || b === undefined || b === 0 ? null : ((a - b) / Math.abs(b)) * 100);

export interface KpiInputs {
  P: PLCalc;
  B: BSCalc;
  /** Opening balance sheet; null when no prior month is loaded. */
  B0: BSCalc | null;
  Pprev: PLCalc | null;
  days: number;
  ocf: number | null;
}

export function computeKpis({ P, B, B0, Pprev, days, ocf }: KpiInputs): Record<string, number | null> {
  const ann = (x: number) => (x * 365) / days;
  const R = P.revenue;
  const k: Record<string, number | null> = {};
  k.total_revenue = P.revenue;
  k.gpm = R ? (P.gross_profit / R) * 100 : null;
  k.opm = R ? (P.operating_profit / R) * 100 : null;
  k.profit_ratio = R ? (P.ebit / R) * 100 : null;
  k.npat = R ? (P.eat / R) * 100 : null;
  k.activity = div(ann(R), B.tic);
  k.ar_days = div(B.ar * days, R);
  k.inv_days = div(B.inventory * days, P.cos);
  k.ap_days = div(B.ap * days, P.cos);
  k.roe = B0 ? x100(div(ann(P.net_income), B0.te)) : null;
  k.roce = x100(div(ann(P.ebit), B.tic));
  k.gmroi = B0 ? x100(div(ann(P.gross_profit), (B.inventory + B0.inventory) / 2)) : null;
  k.asset_turn = div(ann(R), B.ta);
  k.wca = x100(div(B.owc, ann(R)));
  k.current = div(B.tca, B.tcl);
  k.quick = div(B.cash + B.ar, B.tcl);
  k.int_cover = div(P.ebit, P.net_interest);
  k.cash = B.cash;
  k.cf_margin = ocf === null ? null : x100(div(ocf, R));
  k.nvcf = R ? x100(div(ann(R) - ann(P.cos_variable) - ann(P.exp_variable) - B.owc, ann(R))) : null;
  k.rev_growth = Pprev ? growth(P.revenue, Pprev.revenue) : null;
  k.gp_growth = Pprev ? growth(P.gross_profit, Pprev.gross_profit) : null;
  k.ebit_growth = Pprev ? growth(P.ebit, Pprev.ebit) : null;
  k.asset_change = B0 ? growth(B.ta, B0.ta) : null;
  k.equity_change = B0 ? growth(B.te, B0.te) : null;
  k.ebitda_margin = R ? (P.ebitda / R) * 100 : null;
  k.exp_ratio = R ? (P.expenses / R) * 100 : null;
  const vcr = div(P.variable_costs, R);
  k.mos = R && vcr !== null && vcr < 1 ? ((R - P.fixed_costs / (1 - vcr)) / R) * 100 : null;
  const wipDays = div(B.wip * days, P.cos) ?? 0;
  k.ccc = k.ar_days !== null && k.inv_days !== null && k.ap_days !== null ? k.ar_days + k.inv_days + wipDays - k.ap_days : null;
  k.debt_equity = x100(div(B.debt, B.te));
  return k;
}

export type KpiTrend = { value: number; unit: Unit };

/** On/off track and the trend vs the comparison value (blueprint §8.4). */
export function kpiStatus(val: number | null | undefined, tgt: number | null | undefined, direction: "up" | "down", unit: Unit): { ok: boolean | null; trend: KpiTrend | null } {
  if (val === null || val === undefined || tgt === null || tgt === undefined) return { ok: null, trend: null };
  const ok = direction === "up" ? val >= tgt : val <= tgt;
  if (unit === "cur") return { ok, trend: tgt ? { value: ((val - tgt) / Math.abs(tgt)) * 100, unit: "%" } : null };
  return { ok, trend: { value: val - tgt, unit } };
}

export function formatTrend(t: KpiTrend | null, cur: string): string {
  if (!t) return "–";
  if (t.unit === "%" || t.unit === "cur") return pct(t.value);
  if (t.unit === "ratio") return (t.value >= 0 ? "+" : "") + t.value.toFixed(2);
  return num(t.value, t.unit, cur);
}

/** Auto-written plain-English paragraph used in the KPI detail modal. */
export function explainKpi(def: KpiDef, value: number | null, target: number | null, cur: string): string {
  if (value === null) return `${def.about} There is not enough data to calculate it for this period.`;
  let s = def.about + " ";
  if (def.key === "gpm") s += `For each ${cur}100 in sales the business retains ${cur}${value.toFixed(2)} after deducting the cost of sales. `;
  if (def.key === "ar_days") s += `On average, customers pay ${value.toFixed(0)} days after invoicing. `;
  if (def.key === "inv_days") s += `Stock is held for about ${value.toFixed(0)} days before it is sold. `;
  if (def.key === "current") s += `There is ${cur}${value.toFixed(2)} of current assets for every ${cur}1 of current liabilities. `;
  if (target === null) return s.trim();
  const ok = def.direction === "up" ? value >= target : value <= target;
  const word = def.direction === "up" ? (ok ? "above" : "below") : ok ? "below" : "above";
  const t = def.unit === "cur" ? money(target, cur) : num(target, def.unit, cur);
  return (s + `For this period, the ${def.name.toLowerCase()} is ${word} the required target of ${t}.`).trim();
}

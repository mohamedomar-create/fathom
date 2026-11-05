import { assetValues } from "./assets";
import { BENCHMARKS, EGYPT, SDE_MULTIPLE, sizePremium, type Sector } from "./benchmarks";
import { equityBridge, type BridgeItems, type BridgeRow } from "./bridge";
import { combine } from "./combine";
import { dcf, type DcfResult } from "./dcf";
import { multipleValue } from "./multiples";
import { normalise, type Adjustment } from "./normalise";
import { qualityScore, specificPremiumFor, type Quality, type QualityInputs } from "./quality";
import type { MethodKey, MethodResult, Purpose, Range } from "./types";
import { costOfCapital } from "./wacc";

export * from "./types";
export { BENCHMARKS, BENCHMARK_AS_OF, BENCHMARK_SOURCE, SECTORS, EGYPT, type Sector } from "./benchmarks";
export type { Adjustment } from "./normalise";
export type { Quality, QualityKey } from "./quality";
export type { BridgeRow } from "./bridge";

/** The company's own figures for the last twelve months (flows scaled to a year) and its closing balance sheet. */
export interface ValuationInputs extends BridgeItems {
  currency: string;
  label: string;
  /** The last month of the twelve ("2026-09"). */
  end: string;
  /** Months of activity the flows cover (1–12; fewer means they were scaled up to a year). */
  covered: number;
  revenue: number;
  /** The twelve months before, when held. */
  priorRevenue: number | null;
  ebitda: number; da: number; netIncome: number; interest: number;
  /** Capital spending over the year (fixed assets bought), when the opening balance sheet is held. */
  capex: number | null;
  /** Operating working capital (receivables + stock − payables). */
  owc: number;
  taxRate: number;
  equity: number; liabilities: number; ar: number; inventory: number; fixedAssets: number; intangibles: number; otherCA: number;
  /** Average loans over the year (for the cost of debt). */
  avgDebt: number;
  /** Receivables over 180 days and slow stock, when known (otherwise taken from the owner's settings). */
  arOver180?: number | null; slowStock?: number | null;
  quality: QualityInputs;
  /** Annual inflation, % (from the economy assumptions). */
  inflation: number | null;
  partMonth: boolean;
}

/** The owner's and finance's choices; every one has a default. */
export interface ValuationSettings {
  purpose: Purpose;
  sector: Sector;
  riskFree?: number; equityPremium?: number; beta?: number; sizePremium?: number;
  longGrowth?: number;
  /** First projected year's growth (default: last year's, within −10% to +40%). */
  growth?: number;
  /** EBITDA margin reached in year 5 (default: today's). */
  targetMargin?: number;
  privateDiscount?: number;
  debtWeight?: number;
  costOfDebt?: number;
  adjustments?: Adjustment[];
  /** The owner's yearly pay already in the books, added back for the owner-run (SDE) method. */
  ownerPay?: number;
  arOver180?: number; slowStock?: number;
  /** Multiples that replace the sector's reference ranges. */
  multiples?: Partial<Record<"evEbitda" | "evSales" | "pe", Range>>;
  weights?: Partial<Record<MethodKey, number>>;
  /** Local currency per USD, for the USD view. */
  fx?: number;
}

export type LimitKey = "shortHistory" | "annualised" | "partMonth" | "noBalanceSheet" | "openChecks" | "concentration" | "loss"
  | "negativeEquity" | "terminalHeavy" | "highInflation" | "multiples" | "unaudited" | "noCapex" | "assetsAboveEarnings" | "volatile";
export interface Limit { key: LimitKey; effect: "lower" | "wider" | "info"; n?: number }

export interface Valuation {
  currency: string;
  label: string;
  methods: MethodResult[];
  best: Range & { weights: Partial<Record<MethodKey, number>> };
  usd: Range | null;
  capital: { riskFree: number; equityPremium: number; beta: number; sizePremium: number; specificPremium: number; costOfEquity: number; costOfDebt: number; afterTaxDebt: number; debtWeight: number; wacc: number; longGrowth: number };
  dcf: DcfResult | null;
  /** Base-case DCF bridge from enterprise value to equity. */
  bridge: BridgeRow[];
  normalised: { ebitda: number; netIncome: number; total: number };
  quality: Quality;
  limits: Limit[];
  /** WACC (rows) × long-run growth (columns) → equity value, for the sensitivity grid. */
  grid: { wacc: number[]; growth: number[]; value: (number | null)[][] };
  assumptions: { growth: number; margin: number; targetMargin: number; daPct: number; capexPct: number; nwcPct: number; privateDiscount: number };
  sector: Sector;
  purpose: Purpose;
}

/** Default weights by purpose; methods that don't apply drop out and the rest are scaled up. */
export const PURPOSE_WEIGHTS: Record<Purpose, Partial<Record<MethodKey, number>>> = {
  owner: { dcf: 0.35, ebitda: 0.25, pe: 0.1, capitalised: 0.1, sales: 0.05, sde: 0.05, adjustedAssets: 0.1 },
  sale: { dcf: 0.3, ebitda: 0.3, sales: 0.1, pe: 0.1, sde: 0.1, adjustedAssets: 0.1 },
  bank: { dcf: 0.25, ebitda: 0.15, adjustedAssets: 0.3, liquidation: 0.3 },
  partners: { dcf: 0.35, ebitda: 0.25, pe: 0.15, capitalised: 0.1, adjustedAssets: 0.15 },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const point = (v: number): Range => ({ low: v, mid: v, high: v });

export function valueCompany(inp: ValuationInputs, s: ValuationSettings): Valuation {
  const tax = inp.taxRate > 0 ? inp.taxRate : EGYPT.taxRate;
  const norm = normalise({ ebitda: inp.ebitda, netIncome: inp.netIncome, taxRate: tax }, s.adjustments ?? []);
  const quality = qualityScore(inp.quality);
  const bench = { ...BENCHMARKS[s.sector] ?? BENCHMARKS.other, ...s.multiples };
  const discount = s.privateDiscount ?? EGYPT.privateDiscount;
  const bridgeItems: BridgeItems = { cash: inp.cash, investments: inp.investments, debt: inp.debt, lease: inp.lease, endOfService: inp.endOfService, provisions: inp.provisions, dividendsPayable: inp.dividendsPayable };
  const toEquity = (ev: number) => equityBridge(ev, bridgeItems).equity;
  const evRange = (r: Range): Range => ({ low: toEquity(r.low), mid: toEquity(r.mid), high: toEquity(r.high) });

  // ---- cost of capital
  const riskFree = s.riskFree ?? EGYPT.riskFree, equityPremium = s.equityPremium ?? EGYPT.equityPremium, beta = s.beta ?? EGYPT.beta;
  const size = s.sizePremium ?? sizePremium(inp.revenue);
  const specific = specificPremiumFor(quality.score);
  const ownDebtCost = inp.avgDebt > 0 && inp.interest > 0 ? inp.interest / inp.avgDebt : null;
  const costOfDebt = s.costOfDebt ?? clamp(ownDebtCost ?? riskFree + 0.03, 0.05, 0.6);
  const debtWeight = s.debtWeight ?? (inp.equity > 0 ? clamp(inp.debt / (inp.debt + inp.equity), 0, 0.6) : 0.5);
  const cap = costOfCapital({ riskFree, beta, equityPremium, sizePremium: size, specificPremium: specific, costOfDebt, taxRate: tax, debtWeight });
  const longGrowth = Math.min(s.longGrowth ?? EGYPT.longGrowth, cap.wacc - 0.02);

  // ---- DCF
  const margin = inp.revenue > 0 ? norm.ebitda / inp.revenue : 0;
  const targetMargin = s.targetMargin ?? margin;
  const growth0 = s.growth ?? clamp(inp.priorRevenue && inp.priorRevenue > 0 ? inp.revenue / inp.priorRevenue - 1 : longGrowth, -0.1, 0.4);
  const daPct = inp.revenue > 0 ? clamp(inp.da / inp.revenue, 0, 0.3) : 0;
  const capexPct = inp.revenue > 0 ? clamp(Math.max(inp.capex ?? inp.da, inp.da) / inp.revenue, 0, 0.3) : 0;
  const nwcPct = inp.revenue > 0 ? clamp(inp.owc / inp.revenue, -0.3, 1) : 0;
  const years = 5;
  const growth = Array.from({ length: years }, (_, t) => growth0 + ((longGrowth - growth0) * t) / (years - 1));
  const margins = Array.from({ length: years }, (_, t) => margin + ((targetMargin - margin) * (t + 1)) / years);
  const run = (wacc: number, g: number) => dcf({ revenue: inp.revenue, growth, longGrowth: g, ebitdaMargin: margins, daPct, capexPct, nwcPct, taxRate: tax, wacc });
  let dcfBase: DcfResult | null = null, dcfRange: Range | null = null, dcfReason: string | undefined;
  if (!(inp.revenue > 0)) dcfReason = "noRevenue";
  else if (!inp.quality.hasBalanceSheet) dcfReason = "noBalanceSheet";
  else {
    dcfBase = run(cap.wacc, longGrowth);
    const lowR = run(cap.wacc + 0.01, Math.min(longGrowth - 0.005, cap.wacc - 0.02));
    const highR = run(cap.wacc - 0.01, Math.min(longGrowth + 0.005, cap.wacc - 0.02));
    dcfRange = { low: lowR.ev, mid: dcfBase.ev, high: highR.ev };
    if (dcfBase.ev <= 0) { dcfRange = null; dcfReason = "negativeCash"; }
  }

  // ---- methods
  const methods: MethodResult[] = [];
  methods.push({ key: "dcf", ev: dcfRange, value: dcfRange ? evRange(dcfRange) : null, reason: dcfReason });
  const evE = multipleValue(norm.ebitda, bench.evEbitda, discount);
  methods.push({ key: "ebitda", ev: evE, value: evE ? evRange(evE) : null, reason: evE ? undefined : "loss" });
  const evS = multipleValue(inp.revenue, bench.evSales, discount);
  methods.push({ key: "sales", ev: evS, value: evS ? evRange(evS) : null, reason: evS ? undefined : "noRevenue" });
  const pe = multipleValue(norm.netIncome, bench.pe, discount);
  methods.push({ key: "pe", value: pe, reason: pe ? undefined : "loss" });
  const ke = cap.costOfEquity;
  const capd = norm.netIncome > 0 && ke - longGrowth > 0.02
    ? { low: (norm.netIncome * (1 + longGrowth)) / (ke + 0.01 - longGrowth), mid: (norm.netIncome * (1 + longGrowth)) / (ke - longGrowth), high: (norm.netIncome * (1 + longGrowth)) / Math.max(0.02, ke - 0.01 - longGrowth) }
    : null;
  methods.push({ key: "capitalised", value: capd, reason: capd ? undefined : "loss" });
  const sde = norm.ebitda + (s.ownerPay ?? 0);
  const sdeSmall = inp.revenue < 60e6;
  const evSde = sdeSmall ? multipleValue(sde, SDE_MULTIPLE, 0) : null;
  methods.push({ key: "sde", ev: evSde, value: evSde ? evRange(evSde) : null, reason: evSde ? undefined : sdeSmall ? "loss" : "tooLarge" });
  const assets = assetValues({
    equity: inp.equity, cash: inp.cash, ar: inp.ar, arOver180: s.arOver180 ?? inp.arOver180 ?? 0, inventory: inp.inventory,
    slowStock: s.slowStock ?? inp.slowStock ?? 0, fixedAssets: inp.fixedAssets, intangibles: inp.intangibles, investments: inp.investments,
    otherCA: inp.otherCA, liabilities: inp.liabilities, endOfService: 0, lease: 0,
  });
  const hasBs = inp.quality.hasBalanceSheet;
  methods.push({ key: "adjustedAssets", value: hasBs ? point(assets.adjusted) : null, reason: hasBs ? undefined : "noBalanceSheet" });
  methods.push({ key: "bookAssets", value: hasBs ? point(assets.book) : null, reason: hasBs ? undefined : "noBalanceSheet" });
  methods.push({ key: "liquidation", value: hasBs ? point(assets.liquidation) : null, reason: hasBs ? undefined : "noBalanceSheet" });

  const best = combine(methods, s.weights ?? PURPOSE_WEIGHTS[s.purpose]);

  // ---- sensitivity grid around the base WACC and growth
  const waccs = [-0.02, -0.01, 0, 0.01, 0.02].map((d) => cap.wacc + d);
  const gs = [-0.01, -0.005, 0, 0.005, 0.01].map((d) => longGrowth + d);
  const grid = { wacc: waccs, growth: gs, value: waccs.map((w) => gs.map((g) => (dcfBase && w - g > 0.01 ? toEquity(run(w, g).ev) : null))) };

  // ---- limitations, each saying how it moves the answer
  const limits: Limit[] = [];
  const q = inp.quality;
  if (q.months < 24) limits.push({ key: "shortHistory", effect: "wider", n: q.months });
  if (inp.covered < 12) limits.push({ key: "annualised", effect: "wider", n: inp.covered });
  if (inp.partMonth) limits.push({ key: "partMonth", effect: "info" });
  if (!q.hasBalanceSheet) limits.push({ key: "noBalanceSheet", effect: "wider" });
  if (q.openChecks > 0) limits.push({ key: "openChecks", effect: "lower", n: q.openChecks });
  if (q.topCustomerShare != null && q.topCustomerShare > 0.25) limits.push({ key: "concentration", effect: "lower", n: Math.round(q.topCustomerShare * 100) });
  if (q.revenueVolatility != null && q.revenueVolatility > 0.3) limits.push({ key: "volatile", effect: "wider" });
  if (norm.ebitda <= 0 || norm.netIncome <= 0) limits.push({ key: "loss", effect: "lower" });
  if (inp.equity < 0) limits.push({ key: "negativeEquity", effect: "lower" });
  if (dcfBase && dcfBase.terminalShare > 0.75) limits.push({ key: "terminalHeavy", effect: "wider", n: Math.round(dcfBase.terminalShare * 100) });
  if (inp.inflation != null && inp.inflation > 15) limits.push({ key: "highInflation", effect: "wider", n: inp.inflation });
  if (inp.capex == null) limits.push({ key: "noCapex", effect: "info" });
  if (hasBs && assets.adjusted > best.mid && best.mid > 0) limits.push({ key: "assetsAboveEarnings", effect: "info" });
  limits.push({ key: "multiples", effect: "info" }, { key: "unaudited", effect: "info" });

  return {
    currency: inp.currency, label: inp.label, methods, best,
    usd: s.fx && s.fx > 0 ? { low: best.low / s.fx, mid: best.mid / s.fx, high: best.high / s.fx } : null,
    capital: { riskFree, equityPremium, beta, sizePremium: size, specificPremium: specific, costOfEquity: cap.costOfEquity, costOfDebt, afterTaxDebt: cap.afterTaxDebt, debtWeight, wacc: cap.wacc, longGrowth },
    dcf: dcfBase, bridge: dcfBase ? equityBridge(dcfBase.ev, bridgeItems).rows : [],
    normalised: norm, quality, limits, grid,
    assumptions: { growth: growth0, margin, targetMargin, daPct, capexPct, nwcPct, privateDiscount: discount },
    sector: s.sector, purpose: s.purpose,
  };
}

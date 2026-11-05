import { assetValues } from "./assets";
import { BENCHMARKS, EGYPT, SDE_MULTIPLE, sizePremium, type Sector } from "./benchmarks";
import { equityBridge, type BridgeItems, type BridgeRow } from "./bridge";
import { combine } from "./combine";
import { dcf, type DcfResult } from "./dcf";
import { multipleValue } from "./multiples";
import { normalise, type Adjustment } from "./normalise";
import { companyPremium, qualityScore, widthFor, type Quality, type QualityInputs } from "./quality";
import type { MethodKey, MethodResult, Purpose, Range } from "./types";
import { costOfCapital } from "./wacc";

export * from "./types";
export { BENCHMARKS, BENCHMARK_AS_OF, BENCHMARK_SOURCE, SECTORS, EGYPT, EGYPT_AS_OF, type Sector } from "./benchmarks";
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
  /** The part of the lease liability booked inside loans (std/ltd), so it isn't taken off twice. */
  leaseInDebt?: number;
  /** The part of dividends payable booked inside trade payables (it then sits in working capital too). */
  dividendsInAp?: number;
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
  riskFree?: number; longRiskFree?: number; equityPremium?: number; beta?: number; sizePremium?: number;
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
  /** Central multiples that replace the sector's (the low and high move with them, in proportion). */
  multEbitda?: number; multSales?: number; multPe?: number;
  weights?: Partial<Record<MethodKey, number>>;
  /** Local currency per USD, for the USD view. */
  fx?: number;
}

export type LimitKey = "shortHistory" | "annualised" | "partMonth" | "noBalanceSheet" | "openChecks" | "concentration" | "loss"
  | "negativeEquity" | "terminalHeavy" | "highInflation" | "multiples" | "unaudited" | "noCapex" | "assetsAboveEarnings" | "volatile"
  | "debtAboveValue" | "dcfBelowMarket" | "historicalCost" | "noCustomerDetail" | "allCash";
export interface Limit { key: LimitKey; effect: "lower" | "wider" | "info"; n?: number }

export interface Valuation {
  currency: string;
  label: string;
  methods: MethodResult[];
  best: Range & { weights: Partial<Record<MethodKey, number>> };
  usd: Range | null;
  capital: { riskFree: number; longRiskFree: number; equityPremium: number; beta: number; sizePremium: number; specificPremium: number; costOfEquity: number; costOfDebt: number; afterTaxDebt: number; debtWeight: number; wacc: number; terminalWacc: number; longGrowth: number };
  /** The DCF when it applies (null when the method doesn't). */
  dcf: DcfResult | null;
  /** Base-case DCF bridge from enterprise value to equity. */
  bridge: BridgeRow[];
  normalised: { ebitda: number; netIncome: number; total: number };
  quality: Quality;
  limits: Limit[];
  /** Long-run WACC (rows) × long-run growth (columns) → equity value, for the sensitivity grid. */
  grid: { wacc: number[]; growth: number[]; value: (number | null)[][] };
  assumptions: { growth: number; margin: number; targetMargin: number; daPct: number; capexPct: number; nwcPct: number; privateDiscount: number; width: number; multiples: { evEbitda: Range; evSales: Range; pe: Range } };
  sector: Sector;
  purpose: Purpose;
}

/**
 * Default weights by purpose; methods that don't apply drop out and the rest are scaled up. Liquidation is never
 * blended in: it is shown beside the estimate as the floor.
 */
export const PURPOSE_WEIGHTS: Record<Purpose, Partial<Record<MethodKey, number>>> = {
  owner: { dcf: 0.35, ebitda: 0.25, pe: 0.1, capitalised: 0.1, sales: 0.05, sde: 0.05, adjustedAssets: 0.1 },
  sale: { dcf: 0.3, ebitda: 0.3, sales: 0.1, pe: 0.1, sde: 0.1, adjustedAssets: 0.1 },
  bank: { dcf: 0.35, ebitda: 0.3, adjustedAssets: 0.35 },
  partners: { dcf: 0.35, ebitda: 0.25, pe: 0.15, capitalised: 0.1, adjustedAssets: 0.15 },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const point = (v: number): Range => ({ low: v, mid: v, high: v });
const ordered = (r: Range): Range => { const [low, mid, high] = [r.low, r.mid, r.high].sort((a, b) => a - b); return { low, mid, high }; };
const scaled = (r: Range, mid: number): Range => ({ low: (r.low / r.mid) * mid, mid, high: (r.high / r.mid) * mid });

export function valueCompany(inp: ValuationInputs, s: ValuationSettings): Valuation {
  const tax = inp.taxRate > 0 ? inp.taxRate : EGYPT.taxRate;
  const norm = normalise({ ebitda: inp.ebitda, netIncome: inp.netIncome, taxRate: tax }, s.adjustments ?? []);
  const quality = qualityScore(inp.quality);
  const width = widthFor(quality.score);
  const b0 = BENCHMARKS[s.sector] ?? BENCHMARKS.other;
  const bench = {
    evEbitda: s.multEbitda ? scaled(b0.evEbitda, s.multEbitda) : b0.evEbitda,
    evSales: s.multSales ? scaled(b0.evSales, s.multSales) : b0.evSales,
    pe: s.multPe ? scaled(b0.pe, s.multPe) : b0.pe,
  };
  const discount = clamp(s.privateDiscount ?? EGYPT.privateDiscount, 0, 0.6);
  const hasBs = inp.quality.hasBalanceSheet;
  const bridgeItems: BridgeItems = {
    cash: inp.cash, investments: inp.investments, debt: inp.debt, lease: Math.max(0, inp.lease - (inp.leaseInDebt ?? 0)),
    endOfService: inp.endOfService, provisions: inp.provisions, dividendsPayable: inp.dividendsPayable,
  };
  let below = false;
  /** An enterprise value to the owners' share: less net debt, never below zero, less the private-company discount. */
  const toEquity = (ev: number) => { const e = equityBridge(ev, bridgeItems).equity; if (e < 0) below = true; return Math.max(0, e) * (1 - discount); };
  const widen = (r: Range): Range => ({ low: Math.max(0, r.mid - (r.mid - r.low) * width), mid: r.mid, high: r.mid + (r.high - r.mid) * width });
  const evToEquity = (r: Range): Range => widen(ordered({ low: toEquity(r.low), mid: toEquity(r.mid), high: toEquity(r.high) }));
  const eqRange = (r: Range): Range => widen(ordered({ low: Math.max(0, r.low) * (1 - discount), mid: Math.max(0, r.mid) * (1 - discount), high: Math.max(0, r.high) * (1 - discount) }));

  // ---- cost of capital: today's rate for year 1, falling to the long-run rate by year 5 and for the terminal value
  const riskFree = s.riskFree ?? EGYPT.riskFree, equityPremium = s.equityPremium ?? EGYPT.equityPremium, beta = s.beta ?? EGYPT.beta;
  const longRiskFree = Math.min(s.longRiskFree ?? EGYPT.longRiskFree, riskFree);
  const size = s.sizePremium ?? sizePremium(inp.revenue);
  const specific = companyPremium({ topCustomerShare: inp.quality.topCustomerShare, revenueVolatility: inp.quality.revenueVolatility, loss: norm.ebitda <= 0 });
  const ownDebtCost = inp.avgDebt > 0 && inp.interest > 0 ? inp.interest / inp.avgDebt : null;
  const costOfDebt = s.costOfDebt ?? clamp(ownDebtCost ?? riskFree + 0.03, 0.05, 0.6);
  const longDebtCost = Math.max(0.03, costOfDebt - (riskFree - longRiskFree));
  const capAt = (rf: number, kd: number, w: number) => costOfCapital({ riskFree: rf, beta, equityPremium, sizePremium: size, specificPremium: specific, costOfDebt: kd, taxRate: tax, debtWeight: w });

  // ---- DCF drivers
  const margin = inp.revenue > 0 ? norm.ebitda / inp.revenue : 0;
  const targetMargin = s.targetMargin ?? margin;
  const daPct = inp.revenue > 0 ? clamp(inp.da / inp.revenue, 0, 0.3) : 0;
  const capexPct = inp.revenue > 0 ? clamp(Math.max(inp.capex ?? inp.da, inp.da) / inp.revenue, 0, 0.3) : 0;
  const owc = inp.owc + (inp.dividendsInAp ?? 0);
  const nwcPct = inp.revenue > 0 ? clamp(owc / inp.revenue, -0.3, 1) : 0;
  const years = 5;
  const run = (wacc: number, wT: number, g: number, growth0: number) => {
    const growth = Array.from({ length: years }, (_, t) => growth0 + ((g - growth0) * t) / (years - 1));
    const margins = Array.from({ length: years }, (_, t) => margin + ((targetMargin - margin) * (t + 1)) / years);
    return dcf({ revenue: inp.revenue, growth, longGrowth: g, ebitdaMargin: margins, daPct, capexPct, nwcPct, taxRate: tax, wacc, terminalWacc: wT });
  };
  const dcfOk = inp.revenue > 0 && hasBs;
  // Debt's share of capital at the value the business is worth, not at book equity (found in a few rounds).
  let debtWeight = s.debtWeight ?? (inp.equity > 0 ? clamp(inp.debt / (inp.debt + inp.equity), 0, 0.6) : 0.5);
  let cap = capAt(riskFree, costOfDebt, debtWeight), capL = capAt(longRiskFree, longDebtCost, debtWeight);
  let longGrowth = Math.min(s.longGrowth ?? EGYPT.longGrowth, capL.wacc - 0.02);
  const growth0 = s.growth ?? clamp(inp.priorRevenue && inp.priorRevenue > 0 ? inp.revenue / inp.priorRevenue - 1 : longGrowth, -0.1, 0.4);
  if (dcfOk && s.debtWeight == null && inp.debt > 0) {
    for (let k = 0; k < 4; k++) {
      const eq = equityBridge(run(cap.wacc, capL.wacc, longGrowth, growth0).ev, bridgeItems).equity;
      if (!(eq > 0)) break;
      debtWeight = clamp(inp.debt / (inp.debt + eq), 0, 0.6);
      cap = capAt(riskFree, costOfDebt, debtWeight); capL = capAt(longRiskFree, longDebtCost, debtWeight);
      longGrowth = Math.min(s.longGrowth ?? EGYPT.longGrowth, capL.wacc - 0.02);
    }
  }

  let dcfBase: DcfResult | null = null, dcfEv: Range | null = null, dcfReason: string | undefined;
  if (!(inp.revenue > 0)) dcfReason = "noRevenue";
  else if (!hasBs) dcfReason = "noBalanceSheet";
  else {
    dcfBase = run(cap.wacc, capL.wacc, longGrowth, growth0);
    const lowR = run(cap.wacc + 0.01, capL.wacc + 0.01, longGrowth - 0.005, growth0);
    const highR = run(cap.wacc - 0.01, capL.wacc - 0.01, Math.min(longGrowth + 0.005, capL.wacc - 0.015), growth0);
    dcfEv = ordered({ low: lowR.ev, mid: dcfBase.ev, high: highR.ev });
    if (dcfBase.ev <= 0) { dcfEv = null; dcfReason = "negativeCash"; dcfBase = null; }
  }

  // ---- methods (equity value, after the bridge, the zero floor and the private-company discount)
  const methods: MethodResult[] = [];
  methods.push({ key: "dcf", ev: dcfEv, value: dcfEv ? evToEquity(dcfEv) : null, reason: dcfReason });
  const evE = hasBs ? multipleValue(norm.ebitda, bench.evEbitda, 0) : null;
  methods.push({ key: "ebitda", ev: evE, value: evE ? evToEquity(evE) : null, reason: evE ? undefined : hasBs ? "loss" : "noBalanceSheet" });
  const evS = hasBs ? multipleValue(inp.revenue, bench.evSales, 0) : null;
  methods.push({ key: "sales", ev: evS, value: evS ? evToEquity(evS) : null, reason: evS ? undefined : hasBs ? "noRevenue" : "noBalanceSheet" });
  const pe = multipleValue(norm.netIncome, bench.pe, 0);
  methods.push({ key: "pe", value: pe ? eqRange(pe) : null, reason: pe ? undefined : "loss" });
  // Capitalised earnings: what's paid out after the reinvestment that growth needs (g ÷ return on equity), over (Ke − g).
  const keL = capL.costOfEquity;
  const roe = inp.equity > 0 ? norm.netIncome / inp.equity : null;
  const payout = roe && roe > 0 ? clamp(1 - longGrowth / roe, 0.2, 1) : 1;
  const ce = (k: number) => (norm.netIncome * payout * (1 + longGrowth)) / Math.max(0.02, k - longGrowth);
  const capd = norm.netIncome > 0 && keL - longGrowth > 0.02 ? { low: ce(keL + 0.01), mid: ce(keL), high: ce(keL - 0.01) } : null;
  methods.push({ key: "capitalised", value: capd ? eqRange(capd) : null, reason: capd ? undefined : "loss" });
  const sdeSmall = inp.revenue < 50e6;
  const sdeReady = sdeSmall && (s.ownerPay ?? 0) > 0 && hasBs;
  const evSde = sdeReady ? multipleValue(norm.ebitda + (s.ownerPay ?? 0), SDE_MULTIPLE, 0) : null;
  methods.push({ key: "sde", ev: evSde, value: evSde ? evToEquity(evSde) : null, reason: evSde ? undefined : !sdeSmall ? "tooLarge" : !hasBs ? "noBalanceSheet" : (s.ownerPay ?? 0) > 0 ? "loss" : "noOwnerPay" });
  const assets = assetValues({
    equity: inp.equity, cash: inp.cash, ar: inp.ar, arOver180: s.arOver180 ?? inp.arOver180 ?? 0, inventory: inp.inventory,
    slowStock: s.slowStock ?? inp.slowStock ?? 0, fixedAssets: inp.fixedAssets, intangibles: inp.intangibles, investments: inp.investments,
    otherCA: inp.otherCA, liabilities: inp.liabilities, endOfService: 0, lease: 0,
  });
  methods.push({ key: "adjustedAssets", value: hasBs ? point(Math.max(0, assets.adjusted)) : null, reason: hasBs ? undefined : "noBalanceSheet" });
  methods.push({ key: "bookAssets", value: hasBs ? point(Math.max(0, assets.book)) : null, reason: hasBs ? undefined : "noBalanceSheet" });
  methods.push({ key: "liquidation", value: hasBs ? point(Math.max(0, assets.liquidation)) : null, reason: hasBs ? undefined : "noBalanceSheet" });

  const weights = { ...(s.weights ?? PURPOSE_WEIGHTS[s.purpose]), liquidation: 0, bookAssets: 0 };
  const best = combine(methods, weights);

  // ---- sensitivity grid: long-run WACC ± 2 points (today's rate moves with it) × long-run growth ± 1 point
  const shifts = [-0.02, -0.01, 0, 0.01, 0.02];
  const gs = [-0.01, -0.005, 0, 0.005, 0.01].map((d) => longGrowth + d);
  const grid = {
    wacc: shifts.map((d) => capL.wacc + d), growth: gs,
    value: shifts.map((d) => gs.map((g) => (dcfBase && capL.wacc + d - g > 0.01 ? toEquity(run(cap.wacc + d, capL.wacc + d, g, growth0).ev) : null))),
  };

  // ---- limitations, each saying how it moves the answer
  const limits: Limit[] = [];
  const q = inp.quality;
  if (q.months < 24) limits.push({ key: "shortHistory", effect: "wider", n: q.months });
  if (inp.covered < 12) limits.push({ key: "annualised", effect: "wider", n: Math.round(inp.covered * 10) / 10 });
  if (inp.partMonth) limits.push({ key: "partMonth", effect: "info" });
  if (!hasBs) limits.push({ key: "noBalanceSheet", effect: "wider" });
  if (q.openChecks > 0) limits.push({ key: "openChecks", effect: "wider", n: q.openChecks });
  if (q.topCustomerShare != null && q.topCustomerShare > 0.25) limits.push({ key: "concentration", effect: "lower", n: Math.round(q.topCustomerShare * 100) });
  if (q.topCustomerShare == null) limits.push({ key: "noCustomerDetail", effect: "info" });
  if (q.revenueVolatility != null && q.revenueVolatility > 0.3) limits.push({ key: "volatile", effect: "wider" });
  if (norm.ebitda <= 0 || norm.netIncome <= 0) limits.push({ key: "loss", effect: "lower" });
  if (inp.equity < 0) limits.push({ key: "negativeEquity", effect: "lower" });
  if (below) limits.push({ key: "debtAboveValue", effect: "lower" });
  if (dcfBase && dcfBase.terminalShare > 0.75) limits.push({ key: "terminalHeavy", effect: "wider", n: Math.round(dcfBase.terminalShare * 100) });
  if (dcfBase && dcfBase.impliedExitMultiple > 0 && dcfBase.impliedExitMultiple < bench.evEbitda.low) limits.push({ key: "dcfBelowMarket", effect: "wider", n: Math.round(dcfBase.impliedExitMultiple * 10) / 10 });
  if (inp.inflation != null && inp.inflation > 15) limits.push({ key: "highInflation", effect: "wider", n: inp.inflation });
  if (inp.capex == null && hasBs) limits.push({ key: "noCapex", effect: "info" });
  if (hasBs && inp.fixedAssets > 0) limits.push({ key: "historicalCost", effect: "lower" });
  if (hasBs && inp.cash > 0) limits.push({ key: "allCash", effect: "info" });
  if (hasBs && assets.adjusted > best.mid && best.mid > 0) limits.push({ key: "assetsAboveEarnings", effect: "info" });
  limits.push({ key: "multiples", effect: "info" }, { key: "unaudited", effect: "info" });

  return {
    currency: inp.currency, label: inp.label, methods, best,
    usd: s.fx && s.fx > 0 ? { low: best.low / s.fx, mid: best.mid / s.fx, high: best.high / s.fx } : null,
    capital: { riskFree, longRiskFree, equityPremium, beta, sizePremium: size, specificPremium: specific, costOfEquity: cap.costOfEquity, costOfDebt, afterTaxDebt: cap.afterTaxDebt, debtWeight, wacc: cap.wacc, terminalWacc: capL.wacc, longGrowth },
    dcf: dcfBase, bridge: dcfBase ? equityBridge(dcfBase.ev, bridgeItems).rows : [],
    normalised: norm, quality, limits, grid,
    assumptions: { growth: growth0, margin, targetMargin, daPct, capexPct, nwcPct, privateDiscount: discount, width, multiples: bench },
    sector: s.sector, purpose: s.purpose,
  };
}

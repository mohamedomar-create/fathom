import { cashWaterfall, type Waterfall } from "./cashflow";
import { addMonths, daysIn, mlabel, monthIndex, parsePeriod } from "./format";
import { fyStartOf, indexMonths } from "./period";
import type { Assumptions } from "./real-profit";
import { bsCalc, plCalc } from "./statements";
import { type BSCalc, type BSInput, type CompanySettings, type MonthData, type PLCalc, type PLInput } from "./types";

/**
 * Three-way forecast: profit and loss, balance sheet and cash flow projected together month by month, so the balance
 * sheet always balances and cash is the result of everything else rather than a guess.
 *
 * Revenue comes from the method that best predicted the company's own recent months (tested by hiding them, forecasting
 * them from the months before, and measuring the error). Costs follow revenue (variable) or the recent run rate (fixed).
 * Customers, stock and suppliers follow the days held recently. Borrowing, investment and dividends follow the drivers.
 */

export const FORECAST_HORIZONS = [12, 18, 24] as const;
export type Horizon = (typeof FORECAST_HORIZONS)[number];

export interface ForecastDrivers {
  horizon?: Horizon | null;
  /** Revenue growth, % a year. Empty: the tested method decides. */
  revenueGrowth?: number | null;
  /** Gross margin, %. Empty: variable cost of sales follows revenue at the recent ratio. */
  grossMargin?: number | null;
  /** Yearly rise in fixed costs, %. Empty: the inflation assumption, or none. */
  costInflation?: number | null;
  dso?: number | null;
  dio?: number | null;
  dpo?: number | null;
  /** Investment in fixed assets, per month. */
  capex?: number | null;
  /** New long-term borrowing, drawn in the month given (YYYY-MM). */
  loanAmount?: number | null;
  loanMonth?: string | null;
  /** Long-term loan principal repaid each month. */
  repayment?: number | null;
  /** Dividends paid in the forecast, per year, spread evenly. */
  dividends?: number | null;
  /** Borrowing rate, % a year. */
  rate?: number | null;
}

export type RevenueMethod = "seasonal" | "last_year" | "trend" | "average";
export const METHOD_LABEL: Record<RevenueMethod, string> = {
  seasonal: "Trend with seasonal pattern",
  last_year: "Same month last year",
  trend: "Recent trend",
  average: "Recent average",
};
export const METHOD_ABOUT: Record<RevenueMethod, string> = {
  seasonal: "Last year's level, grown at the year-on-year rate, shaped by each month's usual share of the year.",
  last_year: "Each month repeats the same month a year earlier.",
  trend: "The growth rate of the last twelve months (or fewer), carried forward and gently flattened over time.",
  average: "The average of the last six months, held flat.",
};

/** The value used for each driver and where it came from. */
export interface ResolvedDrivers {
  horizon: Horizon;
  revenueGrowth: number | null;
  grossMargin: number | null;
  costInflation: number;
  dso: number;
  dio: number;
  dpo: number;
  capex: number;
  loanAmount: number;
  loanMonth: string | null;
  repayment: number;
  dividends: number;
  rate: number;
}

export interface ForecastMonth {
  period: string;
  pl: PLInput;
  bs: BSInput;
  P: PLCalc;
  B: BSCalc;
  W: Waterfall;
  /** Likely range for revenue, from the size of the backtest error. */
  revenueLow: number;
  revenueHigh: number;
}

export interface Backtest {
  /** Months hidden and forecast. */
  months: number;
  method: RevenueMethod;
  /** Mean absolute % error of monthly revenue. */
  revenueMape: number;
  /** Mean absolute error of monthly EBIT, as % of average monthly revenue. */
  ebitError: number;
  /** Every method tried, best first. */
  tried: { method: RevenueMethod; revenueMape: number }[];
  /** Each hidden month: actual and forecast revenue. */
  detail: { period: string; actual: number; forecast: number }[];
}

export interface ForecastSummary {
  /** First forecast twelve months. */
  revenue12: number;
  netIncome12: number;
  ebit12: number;
  ocf12: number;
  /** The last twelve months held, for comparison. */
  revenueLast12: number | null;
  netIncomeLast12: number | null;
  growth12: number | null;
  /** Lowest month-end cash and when. */
  lowCash: number;
  lowCashMonth: string;
  closingCash: number;
  /** First month cash goes below zero, if it does. */
  cashNegativeFrom: string | null;
  /** Extra funding needed to keep cash at zero or above. */
  fundingNeed: number;
}

export type Forecast =
  | { ok: false; reason: string }
  | {
      ok: true;
      start: string;
      end: string;
      method: RevenueMethod;
      /** Automatic drivers (from history) and those used (with the user's overrides). */
      auto: ResolvedDrivers;
      used: ResolvedDrivers;
      months: ForecastMonth[];
      summary: ForecastSummary;
      backtest: Backtest | null;
      notes: string[];
    };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const has = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const sumBy = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);

/** The last run of consecutive months (a gap ends the history used). */
function consecutiveTail(sorted: MonthData[]): MonthData[] {
  let i = sorted.length - 1;
  while (i > 0 && monthIndex(sorted[i].period) - monthIndex(sorted[i - 1].period) === 1) i--;
  return sorted.slice(i);
}

/** Revenue for the next `h` months by one method, from monthly history (oldest first). */
function projectRevenue(method: RevenueMethod, hist: number[], lastPeriod: string, h: number, growthOverride: number | null): number[] {
  const n = hist.length;
  const out: number[] = [];
  if (method === "seasonal") {
    const last12 = hist.slice(-12), prior12 = hist.slice(-24, -12);
    const level = mean(last12);
    const g = growthOverride !== null ? growthOverride / 100 : clamp(sumBy(last12, (x) => x) / Math.max(1, sumBy(prior12, (x) => x)) - 1, -0.5, 1);
    // Each calendar month's share of its year, averaged over the complete years held. Growth within the year is taken out
    // first (the year's average sits at its middle), so it is not counted twice.
    const gm = Math.pow(1 + clamp(sumBy(last12, (x) => x) / Math.max(1, sumBy(prior12, (x) => x)) - 1, -0.5, 1), 1 / 12);
    const idx = new Array(12).fill(0), cnt = new Array(12).fill(0);
    for (let end = n; end - 12 >= 0; end -= 12) {
      const block = hist.slice(end - 12, end), avg = mean(block);
      if (avg <= 0) continue;
      block.forEach((v, j) => {
        const m = parsePeriod(addMonths(lastPeriod, j - 11 - (n - end))).m - 1;
        idx[m] += v / (avg * Math.pow(gm, j - 5.5)); cnt[m]++;
      });
    }
    const raw = idx.map((v, i) => (cnt[i] ? v / cnt[i] : 1));
    const norm = mean(raw) || 1;
    for (let k = 1; k <= h; k++) {
      const m = parsePeriod(addMonths(lastPeriod, k)).m - 1;
      // The average of the last twelve months sits 5.5 months before the last month.
      out.push(Math.max(0, level * Math.pow(1 + g, (k + 5.5) / 12) * (raw[m] / norm)));
    }
    return out;
  }
  if (method === "last_year") {
    const series = [...hist];
    for (let k = 1; k <= h; k++) {
      const base = series[series.length - 12];
      const v = growthOverride !== null ? base * (1 + growthOverride / 100) : base;
      series.push(Math.max(0, v));
      out.push(Math.max(0, v));
    }
    return out;
  }
  if (method === "trend") {
    const ys = hist.slice(-12).map((v) => Math.max(v, 1));
    const m = ys.length;
    // Least-squares growth on the logarithm: a steady % rate, not a straight line that can run below zero.
    const xs = ys.map((_, i) => i), lx = mean(xs), ly = mean(ys.map(Math.log));
    const sxx = sumBy(xs, (x) => (x - lx) ** 2);
    const slope = sxx ? xs.reduce((s, x, i) => s + (x - lx) * (Math.log(ys[i]) - ly), 0) / sxx : 0;
    const monthly = growthOverride !== null ? Math.pow(1 + growthOverride / 100, 1 / 12) - 1 : clamp(Math.exp(slope) - 1, Math.pow(0.5, 1 / 12) - 1, Math.pow(2, 1 / 12) - 1);
    const fitted = Math.exp(ly + slope * (m - 1 - lx));
    // The fitted level for the last month, blended with the actual three-month average so one odd month does not set the base.
    const base = 0.5 * fitted + 0.5 * mean(hist.slice(-3));
    // Damped: the rate fades by 3% a month when it comes from history; a rate the user sets is held.
    let level = base, damp = 1;
    for (let k = 1; k <= h; k++) {
      damp = growthOverride !== null ? 1 : damp * 0.97;
      level = level * (1 + monthly * damp);
      out.push(Math.max(0, level));
    }
    return out;
  }
  const avg = mean(hist.slice(-6));
  for (let k = 1; k <= h; k++) out.push(Math.max(0, growthOverride !== null ? avg * Math.pow(1 + growthOverride / 100, k / 12) : avg));
  return out;
}

const METHOD_NEEDS: Record<RevenueMethod, number> = { seasonal: 24, last_year: 12, trend: 6, average: 3 };

function mape(actual: number[], fc: number[]) {
  const pairs = actual.map((a, i) => [a, fc[i]] as const).filter(([a]) => Math.abs(a) > 0);
  return pairs.length ? (mean(pairs.map(([a, f]) => Math.abs(f - a) / Math.abs(a))) * 100) : Infinity;
}

/** Interest expense over the last twelve months as a % of average borrowing; null with no borrowing. */
function impliedRate(hist: MonthData[]): number | null {
  const ttm = hist.slice(-12).map((m) => plCalc(m.pl)), ttmB = hist.slice(-13).map((m) => bsCalc(m.bs));
  const debtAvg = mean(ttmB.map((b) => b.debt));
  return debtAvg > 0 ? ((sumBy(ttm, (p) => p.interest_expenses) * (12 / ttm.length)) / debtAvg) * 100 : null;
}

/** Drivers measured on the recent history. */
function autoDrivers(hist: MonthData[], settings: CompanySettings, a: Assumptions, horizon: Horizon): ResolvedDrivers {
  const Ps = hist.map((m) => plCalc(m.pl)), Bs = hist.map((m) => bsCalc(m.bs));
  const q = Math.min(3, hist.length - 1);
  const recentP = Ps.slice(-q), recentB = Bs.slice(-(q + 1));
  const days = sumBy(hist.slice(-q), (m) => daysIn(m.period));
  const rev = sumBy(recentP, (p) => p.revenue), cogs = sumBy(recentP, (p) => p.cos - p.cos_depreciation);
  const avgB = (k: keyof BSCalc) => mean(recentB.map((b) => b[k] as number));
  const dso = rev > 0 ? (avgB("ar") / rev) * days : 0;
  const dio = cogs > 0 ? (avgB("inventory") / cogs) * days : 0;
  const dpo = cogs > 0 ? (avgB("ap") / cogs) * days : 0;
  const t = Math.min(12, hist.length - 1);
  const capexHist: number[] = [];
  for (let i = hist.length - t; i < hist.length; i++) capexHist.push(Bs[i].fixed_assets - Bs[i - 1].fixed_assets + Ps[i].da);
  const capex = Math.max(0, mean(capexHist));
  const implied = impliedRate(hist) ?? 0;
  // Without a rate entered, the rate the books show (interest over average borrowing) keeps interest at its recorded level.
  const rate = has(a.rate) ? a.rate : clamp(implied, 0, 200);
  return {
    horizon, revenueGrowth: null, grossMargin: null,
    costInflation: has(a.inflation) ? a.inflation : 0,
    dso, dio, dpo, capex, loanAmount: 0, loanMonth: null,
    repayment: has(a.principal12m) ? a.principal12m / 12 : 0,
    dividends: 0, rate,
  };
}

function resolve(auto: ResolvedDrivers, d: ForecastDrivers): ResolvedDrivers {
  const pick = (v: number | null | undefined, fallback: number) => (has(v) ? v : fallback);
  return {
    horizon: (FORECAST_HORIZONS as readonly number[]).includes(d.horizon ?? 0) ? (d.horizon as Horizon) : auto.horizon,
    revenueGrowth: has(d.revenueGrowth) ? d.revenueGrowth : null,
    grossMargin: has(d.grossMargin) ? d.grossMargin : null,
    costInflation: pick(d.costInflation, auto.costInflation),
    dso: Math.max(0, pick(d.dso, auto.dso)), dio: Math.max(0, pick(d.dio, auto.dio)), dpo: Math.max(0, pick(d.dpo, auto.dpo)),
    capex: Math.max(0, pick(d.capex, auto.capex)),
    loanAmount: Math.max(0, pick(d.loanAmount, 0)), loanMonth: d.loanMonth ?? null,
    repayment: Math.max(0, pick(d.repayment, auto.repayment)),
    dividends: Math.max(0, pick(d.dividends, 0)),
    rate: Math.max(0, pick(d.rate, auto.rate)),
  };
}

const NON_CASH = ["ar", "inventory", "wip", "other_ca", "fixed_assets", "intangibles", "investments"] as const;
const CLAIMS = ["std", "ap", "tax_liab", "other_cl", "ltd", "other_ncl", "retained_earnings", "other_equity"] as const;
const nonCash = (b: BSInput) => sumBy([...NON_CASH], (k) => b[k] ?? 0);
const claims = (b: BSInput) => sumBy([...CLAIMS], (k) => b[k] ?? 0);

/** Builds the forecast months from history with a given revenue path and drivers. */
function project(hist: MonthData[], revenue: number[], dv: ResolvedDrivers, settings: CompanySettings): ForecastMonth[] {
  const Ps = hist.map((m) => plCalc(m.pl));
  const last = hist[hist.length - 1];
  const ttm = Ps.slice(-12), recent = Ps.slice(-3);
  const ttmRev = sumBy(ttm, (p) => p.revenue);
  const ratio = (k: "cos_variable" | "exp_variable") => (ttmRev > 0 ? sumBy(ttm, (p) => p[k]) / ttmRev : 0);
  const vcos = ratio("cos_variable"), vexp = ratio("exp_variable");
  const run = (k: keyof PLCalc) => mean(recent.map((p) => p[k] as number));
  const fcos0 = run("cos_fixed"), fexp0 = run("exp_fixed"), cosDep0 = run("cos_depreciation"), expDep0 = run("exp_depreciation");
  const otherInc = mean(ttm.map((p) => p.other_income)), otherExp = mean(ttm.map((p) => p.other_expenses)), intInc = mean(ttm.map((p) => p.interest_income));
  const B0 = bsCalc(last.bs);
  const daAnnual = (cosDep0 + expDep0) * 12;
  const life = daAnnual > 0 && B0.fixed_assets > 0 ? clamp(B0.fixed_assets / daAnnual, 2, 30) : 5;
  const tax = settings.taxRate;
  let prev: BSInput = { ...last.bs };
  let prevB = B0;
  // The financial year to date carries into the forecast: a loss in its earlier actual months is offset before tax is
  // charged. The actual months are taken as fully taxed at the rate (their booked tax may be accrued only at year end).
  const fy0 = fyStartOf(last.period, settings.fyStartMonth);
  let ytdEbt = sumBy(hist.filter((m) => m.period >= fy0), (m) => plCalc(m.pl).ebt);
  let ytdTax = Math.max(0, ytdEbt * settings.taxRate);
  let cumCapex = 0;
  const out: ForecastMonth[] = [];
  revenue.forEach((rev, i) => {
    const period = addMonths(last.period, i + 1);
    const days = daysIn(period);
    if (parsePeriod(period).m === settings.fyStartMonth) { ytdEbt = 0; ytdTax = 0; }
    const infl = Math.pow(1 + dv.costInflation / 100, (i + 1) / 12);
    const fcos = fcos0 * infl, fexp = fexp0 * infl;
    cumCapex += dv.capex;
    const fa0 = prev.fixed_assets ?? 0;
    const depWanted = cosDep0 + expDep0 + cumCapex / (life * 12);
    const dep = Math.min(depWanted, Math.max(0, fa0 + dv.capex));
    const share = cosDep0 + expDep0 > 0 ? cosDep0 / (cosDep0 + expDep0) : 0;
    const cosDep = dep * share, expDep = dep - cosDep;
    const cosVar = dv.grossMargin !== null ? Math.max(0, rev * (1 - dv.grossMargin / 100) - fcos - cosDep) : rev * vcos;
    const ltd0 = prev.ltd ?? 0;
    const drawn = dv.loanMonth === period ? dv.loanAmount : 0;
    const ltd = Math.max(0, ltd0 - dv.repayment) + drawn;
    const std = prev.std ?? 0;
    const interest = ((std + (ltd0 + ltd) / 2) * dv.rate) / 100 / 12;
    const pl: PLInput = {
      revenue: rev, cos_variable: cosVar, cos_fixed: fcos, cos_depreciation: cosDep,
      exp_variable: rev * vexp, exp_fixed: fexp, exp_depreciation: expDep,
      other_income: otherInc, other_expenses: otherExp, interest_income: intInc, interest_expenses: interest,
      adjustments: 0, dividends: dv.dividends / 12,
    };
    // Tax on the year's profit to date, so a loss earlier in the year is offset before tax is charged.
    const pre = plCalc(pl);
    ytdEbt += pre.ebt;
    const taxDue = Math.max(0, ytdEbt * tax) - ytdTax;
    ytdTax += taxDue;
    pl.tax_expenses = taxDue;
    const P = plCalc(pl);
    const cogs = P.cos - P.cos_depreciation;
    const bs: BSInput = { ...prev };
    bs.ar = (rev * dv.dso) / days;
    bs.inventory = (cogs * dv.dio) / days;
    bs.ap = (cogs * dv.dpo) / days;
    bs.fixed_assets = fa0 + dv.capex - dep;
    bs.ltd = ltd;
    bs.retained_earnings = (prev.retained_earnings ?? 0) + P.net_income - P.dividends;
    // Cash is what is left: the change in what is owed and owned, everything else held.
    bs.cash = (prev.cash ?? 0) + (claims(bs) - claims(prev)) - (nonCash(bs) - nonCash(prev));
    const B = bsCalc(bs);
    out.push({ period, pl, bs, P, B, W: cashWaterfall(P, B, prevB), revenueLow: rev, revenueHigh: rev });
    prev = bs; prevB = B;
  });
  return out;
}

/** Tests each eligible method by hiding the latest months and forecasting them from the months before. */
function backtest(hist: MonthData[], settings: CompanySettings, a: Assumptions): Backtest | null {
  const n = hist.length;
  const H = Math.min(6, Math.floor(n / 4));
  if (H < 2) return null;
  const train = hist.slice(0, n - H), test = hist.slice(n - H);
  const trainRev = train.map((m) => plCalc(m.pl).revenue);
  const actualRev = test.map((m) => plCalc(m.pl).revenue);
  const tried: { method: RevenueMethod; revenueMape: number; fc: number[] }[] = [];
  for (const method of Object.keys(METHOD_NEEDS) as RevenueMethod[]) {
    if (train.length < METHOD_NEEDS[method]) continue;
    const fc = projectRevenue(method, trainRev, train[train.length - 1].period, H, null);
    tried.push({ method, revenueMape: mape(actualRev, fc), fc });
  }
  if (!tried.length) return null;
  tried.sort((x, y) => x.revenueMape - y.revenueMape);
  const best = tried[0];
  const months = project(train, best.fc, autoDrivers(train, settings, a, 12), settings);
  const avgRev = mean(actualRev.map(Math.abs)) || 1;
  const ebitError = (mean(test.map((m, i) => Math.abs(months[i].P.ebit - plCalc(m.pl).ebit))) / avgRev) * 100;
  return {
    months: H, method: best.method, revenueMape: best.revenueMape, ebitError,
    tried: tried.map(({ method, revenueMape }) => ({ method, revenueMape })),
    detail: test.map((m, i) => ({ period: m.period, actual: actualRev[i], forecast: best.fc[i] })),
  };
}

export function forecast(months: MonthData[], settings: CompanySettings, drivers: ForecastDrivers = {}, assumptions: Assumptions = {}): Forecast {
  const { sorted } = indexMonths(months);
  if (!sorted.length) return { ok: false, reason: "Load at least six months of monthly figures to forecast." };
  const hist = consecutiveTail(sorted);
  // Audited annual columns are a year apart: they cannot drive a monthly forecast.
  if (hist.length < 6) return { ok: false, reason: `Forecasting needs at least six consecutive months of figures; the latest run has ${hist.length}.` };
  const revHist = hist.map((m) => plCalc(m.pl).revenue);
  if (sumBy(revHist.slice(-6), (x) => x) <= 0) return { ok: false, reason: "There is no revenue in the last six months to forecast from." };
  const bt = backtest(hist, settings, assumptions);
  const eligible = (Object.keys(METHOD_NEEDS) as RevenueMethod[]).filter((m) => hist.length >= METHOD_NEEDS[m]);
  const method: RevenueMethod = bt && eligible.includes(bt.method) ? bt.method : eligible.includes("trend") ? "trend" : "average";
  const horizon: Horizon = (FORECAST_HORIZONS as readonly number[]).includes(drivers.horizon ?? 0) ? (drivers.horizon as Horizon) : 12;
  const auto = autoDrivers(hist, settings, assumptions, horizon);
  const used = resolve(auto, drivers);
  const last = hist[hist.length - 1].period;
  const revenue = projectRevenue(method, revHist, last, used.horizon, used.revenueGrowth);
  const fm = project(hist, revenue, used, settings);
  // The likely range widens with distance, from the backtest error (the square-root rule for accumulating error).
  const err = bt ? Math.min(0.5, bt.revenueMape / 100) : 0.15;
  fm.forEach((m, i) => {
    const w = Math.min(0.6, err * Math.sqrt((i + 1) / (bt?.months ?? 3)));
    m.revenueLow = m.P.revenue * (1 - w); m.revenueHigh = m.P.revenue * (1 + w);
  });
  const first12 = fm.slice(0, 12);
  const histP = hist.map((m) => plCalc(m.pl));
  const last12 = hist.length >= 12 ? histP.slice(-12) : null;
  let low = fm[0];
  for (const m of fm) if (m.B.cash < low.B.cash) low = m;
  const neg = fm.find((m) => m.B.cash < 0);
  const revenue12 = sumBy(first12, (m) => m.P.revenue);
  const revenueLast12 = last12 ? sumBy(last12, (p) => p.revenue) : null;
  const summary: ForecastSummary = {
    revenue12, netIncome12: sumBy(first12, (m) => m.P.net_income), ebit12: sumBy(first12, (m) => m.P.ebit), ocf12: sumBy(first12, (m) => m.W.ocf),
    revenueLast12, netIncomeLast12: last12 ? sumBy(last12, (p) => p.net_income) : null,
    growth12: revenueLast12 && revenueLast12 > 0 ? (revenue12 / revenueLast12 - 1) * 100 : null,
    lowCash: low.B.cash, lowCashMonth: low.period, closingCash: fm[fm.length - 1].B.cash,
    cashNegativeFrom: neg?.period ?? null, fundingNeed: Math.max(0, -low.B.cash),
  };
  const notes: string[] = [];
  if (hist.length < sorted.length) notes.push(`A gap in the months loaded: the forecast uses the ${hist.length} consecutive months from ${mlabel(hist[0].period)}.`);
  if (hist.length < 24) notes.push(hist.length < 12 ? "With under a year of figures there is no seasonal pattern to learn; load 24 months or more for one." : "With under two years of figures the seasonal pattern rests on one year; 24 months or more make it reliable.");
  if (Math.abs(bsCalc(hist[hist.length - 1].bs).imbalance) > 1) notes.push("The latest balance sheet does not balance; the difference is carried unchanged through the forecast.");
  if (!has(assumptions.principal12m) && !has(drivers.repayment) && bsCalc(hist[hist.length - 1].bs).ltd > 0) notes.push("Loan repayments are not entered, so long-term borrowing is held at today's balance. Enter the monthly repayment for a truer cash line.");
  const booked = impliedRate(hist);
  if ((has(drivers.rate) || has(assumptions.rate)) && booked !== null && Math.abs(booked - used.rate) > 10) notes.push(`Interest in the books is ${booked.toFixed(0)}% a year of average borrowing; the forecast uses the ${used.rate.toFixed(1)}% rate entered, so interest changes from the first forecast month.`);
  if (!has(drivers.rate) && !has(assumptions.rate) && auto.rate > 40) notes.push(`Interest in the books is ${auto.rate.toFixed(0)}% a year of average borrowing, which is high: check that interest and loans are mapped correctly, or enter your borrowing rate.`);
  if (used.dividends === 0) notes.push("No dividends are assumed.");
  return { ok: true, start: fm[0].period, end: fm[fm.length - 1].period, method, auto, used, months: fm, summary, backtest: bt, notes };
}

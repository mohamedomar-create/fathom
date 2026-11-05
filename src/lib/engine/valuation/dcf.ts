export interface DcfInputs {
  /** Last twelve months' revenue (the base year). */
  revenue: number;
  /** Growth for each projected year (fraction). */
  growth: number[];
  /** Growth after the last projected year, for the terminal value. */
  longGrowth: number;
  /** EBITDA margin for each projected year. */
  ebitdaMargin: number[];
  /** Depreciation and capital spending as shares of revenue. */
  daPct: number;
  capexPct: number;
  /** Working capital as a share of revenue: each extra pound of sales ties up this much. */
  nwcPct: number;
  taxRate: number;
  /** The discount rate for year 1. */
  wacc: number;
  /** The long-run rate it falls to by the last year and keeps for the terminal value (default: the same as wacc). */
  terminalWacc?: number;
}

export interface DcfYear { year: number; revenue: number; ebitda: number; ebit: number; tax: number; capex: number; dNwc: number; fcf: number; discount: number; pv: number }

export interface DcfResult {
  years: DcfYear[];
  terminal: number;
  pvTerminal: number;
  ev: number;
  /** Share of the value in the terminal value (above 75% the answer rests mostly on the long-run assumption). */
  terminalShare: number;
  /** Terminal value ÷ the last year's EBITDA: a check against market multiples. */
  impliedExitMultiple: number;
}

/**
 * Free cash flow to the firm for each projected year, discounted at mid-year (cash arrives through the year), plus a
 * Gordon terminal value: FCF × (1 + g) ÷ (WACC − g). The discount rate can fall in a straight line from today's rate
 * to a long-run one by the last year (in Egypt today's bond yields carry today's inflation, which is not expected to
 * last for ever); each year's rate compounds on the years before it. The terminal value uses the long-run rate and,
 * like the yearly flows, is discounted half a year less than the year end.
 */
export function dcf(i: DcfInputs): DcfResult {
  const wT = i.terminalWacc ?? i.wacc;
  if (!(wT - i.longGrowth > 0.005) || !(i.wacc - i.longGrowth > 0.005)) throw new Error("The long-run growth must be below the discount rate.");
  const n = i.growth.length;
  const rate = (t: number) => (n <= 1 ? wT : i.wacc + ((wT - i.wacc) * t) / (n - 1));
  const years: DcfYear[] = [];
  let prev = i.revenue;
  let df = 1;
  for (let t = 0; t < n; t++) {
    const revenue = prev * (1 + i.growth[t]);
    const ebitda = revenue * (i.ebitdaMargin[t] ?? i.ebitdaMargin[i.ebitdaMargin.length - 1]);
    const ebit = ebitda - revenue * i.daPct;
    const tax = Math.max(0, ebit) * i.taxRate;
    const capex = revenue * i.capexPct;
    const dNwc = (revenue - prev) * i.nwcPct;
    const fcf = ebit - tax + revenue * i.daPct - capex - dNwc;
    const w = rate(t);
    const discount = df / Math.sqrt(1 + w);
    df /= 1 + w;
    years.push({ year: t + 1, revenue, ebitda, ebit, tax, capex, dNwc, fcf, discount, pv: fcf * discount });
    prev = revenue;
  }
  const last = years[n - 1];
  const terminal = (last.fcf * (1 + i.longGrowth)) / (wT - i.longGrowth);
  const pvTerminal = terminal * df * Math.sqrt(1 + wT);
  const ev = years.reduce((s, y) => s + y.pv, 0) + pvTerminal;
  return { years, terminal, pvTerminal, ev, terminalShare: ev > 0 ? pvTerminal / ev : 1, impliedExitMultiple: last.ebitda > 0 ? terminal / last.ebitda : 0 };
}

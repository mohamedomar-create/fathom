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
  wacc: number;
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
 * Gordon terminal value at the end of the last year: FCF × (1 + g) ÷ (WACC − g).
 */
export function dcf(i: DcfInputs): DcfResult {
  if (!(i.wacc - i.longGrowth > 0.005)) throw new Error("The long-run growth must be below the discount rate.");
  const n = i.growth.length;
  const years: DcfYear[] = [];
  let prev = i.revenue;
  for (let t = 0; t < n; t++) {
    const revenue = prev * (1 + i.growth[t]);
    const ebitda = revenue * (i.ebitdaMargin[t] ?? i.ebitdaMargin[i.ebitdaMargin.length - 1]);
    const ebit = ebitda - revenue * i.daPct;
    const tax = Math.max(0, ebit) * i.taxRate;
    const capex = revenue * i.capexPct;
    const dNwc = (revenue - prev) * i.nwcPct;
    const fcf = ebit - tax + revenue * i.daPct - capex - dNwc;
    const discount = 1 / Math.pow(1 + i.wacc, t + 0.5);
    years.push({ year: t + 1, revenue, ebitda, ebit, tax, capex, dNwc, fcf, discount, pv: fcf * discount });
    prev = revenue;
  }
  const last = years[n - 1];
  const terminal = (last.fcf * (1 + i.longGrowth)) / (i.wacc - i.longGrowth);
  const pvTerminal = terminal / Math.pow(1 + i.wacc, n);
  const ev = years.reduce((s, y) => s + y.pv, 0) + pvTerminal;
  return { years, terminal, pvTerminal, ev, terminalShare: ev > 0 ? pvTerminal / ev : 1, impliedExitMultiple: last.ebitda > 0 ? terminal / last.ebitda : 0 };
}

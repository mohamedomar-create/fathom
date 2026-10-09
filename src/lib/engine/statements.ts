import { BS_KEYS, PL_KEYS, type BSCalc, type BSInput, type PLCalc, type PLInput } from "./types";

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

export function plCalc(pl: PLInput): PLCalc {
  const g = Object.fromEntries(PL_KEYS.map((k) => [k, n(pl[k])])) as Record<(typeof PL_KEYS)[number], number>;
  const cos = g.cos_variable + g.cos_fixed + g.cos_depreciation;
  const expenses = g.exp_variable + g.exp_fixed + g.exp_depreciation;
  const gross_profit = g.revenue - cos;
  const operating_profit = gross_profit - expenses;
  const ebit = operating_profit + g.other_income - g.other_expenses;
  const ebt = ebit + g.interest_income - g.interest_expenses;
  const eat = ebt - g.tax_expenses;
  const net_income = eat - g.adjustments;
  const da = g.cos_depreciation + g.exp_depreciation;
  return {
    ...g, cos, expenses, gross_profit, operating_profit, ebit, ebt, eat, net_income,
    retained_income: net_income - g.dividends,
    da, ebitda: ebit + da,
    net_interest: g.interest_expenses - g.interest_income,
    variable_costs: g.cos_variable + g.exp_variable,
    fixed_costs: g.cos_fixed + g.exp_fixed + da,
  };
}

export function bsCalc(bs: BSInput): BSCalc {
  const b = Object.fromEntries(BS_KEYS.map((k) => [k, n(bs[k])])) as Record<(typeof BS_KEYS)[number], number>;
  const tca = b.cash + b.ar + b.inventory + b.wip + b.other_ca;
  const tnca = b.fixed_assets + b.intangibles + b.investments;
  const ta = tca + tnca;
  const tcl = b.std + b.ap + b.tax_liab + b.other_cl;
  const tncl = b.ltd + b.other_ncl;
  const tl = tcl + tncl;
  const te = b.retained_earnings + b.other_equity;
  const tle = tl + te;
  const debt = b.std + b.ltd;
  const owc = b.ar + b.inventory + b.wip - b.ap;
  return { ...b, tca, tnca, ta, tcl, tncl, tl, te, tle, imbalance: ta - tle, debt, owc, tic: te + debt, toi: owc + b.fixed_assets };
}

/** Sum P&L inputs across months (P&L is a flow). */
export function sumPL(list: PLInput[]): PLInput {
  const out: PLInput = {};
  for (const k of PL_KEYS) out[k] = list.reduce((s, p) => s + n(p[k]), 0);
  return out;
}

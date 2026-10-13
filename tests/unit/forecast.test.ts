import { describe, expect, it } from "vitest";
import sample from "../../reference/sample.json";
import { addMonths, daysIn, forecast, parsePeriod, type CompanySettings, type MonthData } from "@/lib/engine";

const S: CompanySettings = { currency: "EGP", fyStartMonth: 1, taxRate: 0.225 };
const SEASON = [0.8, 0.85, 1.0, 1.05, 1.1, 0.95, 0.9, 0.95, 1.05, 1.1, 1.15, 1.1];

/**
 * A balanced company with a known revenue path: monthly growth `g` and, optionally, a seasonal shape.
 * Costs: 40% variable cost of sales, 20,000 fixed, 5,000 depreciation; customers 45 days; stock 30 days; suppliers 30 days.
 */
function company(n: number, opts: { g?: number; seasonal?: boolean; start?: string } = {}): MonthData[] {
  const out: MonthData[] = [];
  let re = 100000, fa = 300000;
  const start = opts.start ?? "2023-01";
  const rev = (i: number) => 100000 * Math.pow(1 + (opts.g ?? 0), i) * (opts.seasonal ? SEASON[parsePeriod(addMonths(start, i)).m - 1] : 1);
  const bsFor = (i: number, cash: number) => {
    const p = addMonths(start, i), r = rev(i), d = daysIn(p), cogs = r * 0.4;
    return { cash, ar: (r * 45) / d, inventory: (cogs * 30) / d, ap: (cogs * 30) / d, fixed_assets: fa, other_equity: 200000, retained_earnings: re };
  };
  // Opening month: cash makes it balance.
  let prev = bsFor(0, 0);
  prev.cash = prev.ap + prev.other_equity + prev.retained_earnings - prev.ar - prev.inventory - prev.fixed_assets;
  out.push({ period: start, pl: { revenue: rev(0), cos_variable: rev(0) * 0.4, exp_fixed: 20000, exp_depreciation: 5000, tax_expenses: 0 }, bs: prev });
  for (let i = 1; i < n; i++) {
    const r = rev(i);
    const pl = { revenue: r, cos_variable: r * 0.4, exp_fixed: 20000, exp_depreciation: 5000 };
    const ni = r * 0.6 - 25000;
    re += ni; fa -= 5000;
    const bs = bsFor(i, 0);
    bs.cash = bs.ap + bs.other_equity + bs.retained_earnings - bs.ar - bs.inventory - bs.fixed_assets;
    out.push({ period: addMonths(start, i), pl, bs });
    prev = bs;
  }
  return out;
}
const S0: CompanySettings = { ...S, taxRate: 0 };

describe("three-way forecast", () => {
  it("keeps the balance sheet balanced and cash reconciled every month", () => {
    const f = forecast(company(30, { g: 0.01, seasonal: true }), S, { horizon: 24, loanAmount: 500000, loanMonth: "2025-09", repayment: 10000, dividends: 120000, capex: 8000 });
    if (!f.ok) throw new Error(f.reason);
    expect(f.months).toHaveLength(24);
    let prev = company(30, { g: 0.01, seasonal: true }).at(-1)!.bs;
    for (const m of f.months) {
      expect(Math.abs(m.B.imbalance)).toBeLessThan(0.01);
      expect(m.W.ncf).toBeCloseTo((m.B.cash - (prev.cash ?? 0)) - (m.B.debt - ((prev.std ?? 0) + (prev.ltd ?? 0))), 4);
      expect(m.W.ocf).toBeGreaterThan(-Infinity);
      prev = m.bs;
    }
  });

  it("learns a seasonal pattern and growth from three years of figures", () => {
    const hist = company(36, { g: 0.008, seasonal: true });
    const f = forecast(hist, S0);
    if (!f.ok) throw new Error(f.reason);
    expect(f.method).toBe("seasonal");
    expect(f.backtest!.revenueMape).toBeLessThan(2);
    const truth = company(48, { g: 0.008, seasonal: true }).slice(36);
    f.months.forEach((m, i) => expect(Math.abs(m.P.revenue / truth[i].pl.revenue! - 1)).toBeLessThan(0.02));
  });

  it("follows a steady trend when there is no season", () => {
    const f = forecast(company(15, { g: 0.02 }), S0);
    if (!f.ok) throw new Error(f.reason);
    expect(["trend", "last_year"]).toContain(f.method);
    expect(f.months[0].P.revenue).toBeGreaterThan(company(15, { g: 0.02 }).at(-1)!.pl.revenue!);
    expect(f.backtest!.tried.length).toBeGreaterThan(1);
  });

  it("customers, stock and suppliers follow the days held, on a rolling three months of flows", () => {
    const hist = company(12);
    const f = forecast(hist, S0);
    if (!f.ok) throw new Error(f.reason);
    expect(f.auto.dso).toBeCloseTo(45, 0);
    expect(f.auto.dio).toBeCloseTo(30, 0);
    // Month 3: the rolling window is the first three forecast months.
    const r = f.months.slice(0, 3), d = r.reduce((s, m) => s + daysIn(m.period), 0);
    const rev = r.reduce((s, m) => s + m.P.revenue, 0), cogs = r.reduce((s, m) => s + m.P.cos - m.P.cos_depreciation, 0);
    expect(r[2].B.ar).toBeCloseTo((rev * f.used.dso) / d, 6);
    expect(r[2].B.ap).toBeCloseTo((cogs * f.used.dpo) / d, 6);
  });

  it("days are today's: the first forecast month carries debtors on from the last balance, not a step to an average", () => {
    const hist = company(12);
    // Debtors jump in the last month: averaging older balances would release that cash in forecast month one.
    hist[hist.length - 1] = { ...hist[hist.length - 1], bs: { ...hist[hist.length - 1].bs, ar: (hist[hist.length - 1].bs.ar ?? 0) * 3, cash: (hist[hist.length - 1].bs.cash ?? 0) - (hist[hist.length - 1].bs.ar ?? 0) * 2 } };
    const f = forecast(hist, S0);
    if (!f.ok) throw new Error(f.reason);
    const ar0 = hist[hist.length - 1].bs.ar!;
    expect(Math.abs(f.months[0].B.ar - ar0) / ar0).toBeLessThan(0.15);
  });

  it("a credit balance on debtors is held, not turned into days", () => {
    const hist = company(12);
    hist[hist.length - 1] = { ...hist[hist.length - 1], bs: { ...hist[hist.length - 1].bs, cash: (hist[hist.length - 1].bs.cash ?? 0) + (hist[hist.length - 1].bs.ar ?? 0) + 5000, ar: -5000 } };
    const f = forecast(hist, S0);
    if (!f.ok) throw new Error(f.reason);
    expect(f.used.hold?.ar).toBe(true);
    f.months.forEach((m) => expect(m.B.ar).toBe(-5000));
  });

  it("drivers move the numbers as they should", () => {
    const hist = company(12);
    const base = forecast(hist, S0);
    const loan = forecast(hist, S0, { loanAmount: 1e6, loanMonth: "2024-02" });
    const gm = forecast(hist, S0, { grossMargin: 70 });
    const growth = forecast(hist, S0, { revenueGrowth: 24 });
    if (!base.ok || !loan.ok || !gm.ok || !growth.ok) throw new Error("forecast failed");
    const feb = (x: typeof base) => x.months.find((m) => m.period === "2024-02")!;
    expect(feb(loan).B.ltd - feb(base).B.ltd).toBeCloseTo(1e6, 6);
    expect(feb(loan).B.cash - feb(base).B.cash).toBeCloseTo(1e6, 6);
    gm.months.forEach((m) => expect(m.P.gross_profit / m.P.revenue).toBeCloseTo(0.7, 9));
    expect(growth.summary.revenue12).toBeGreaterThan(base.summary.revenue12 * 1.1);
  });

  it("charges tax on the year's profit to date, offsetting earlier losses", () => {
    // A loss-making start (fixed costs above contribution), then profit: tax only once the year is in profit.
    const hist = company(12).map((m) => ({ ...m, pl: { ...m.pl, exp_fixed: 70000 } }));
    const f = forecast(hist, S, { revenueGrowth: 300, horizon: 12 });
    if (!f.ok) throw new Error(f.reason);
    let ytd = 0, taxed = 0;
    for (const m of f.months) {
      if (parsePeriod(m.period).m === 1) { ytd = 0; taxed = 0; }
      ytd += m.P.ebt; taxed += m.P.tax_expenses;
      expect(taxed).toBeCloseTo(Math.max(0, ytd * 0.225), 6);
    }
  });

  it("warns of the month cash runs out and the funding needed", () => {
    const f = forecast(company(12), S0, { dividends: 12e6 });
    if (!f.ok) throw new Error(f.reason);
    expect(f.summary.cashNegativeFrom).not.toBeNull();
    expect(f.summary.fundingNeed).toBeCloseTo(-f.summary.lowCash, 6);
  });

  it("needs six consecutive months", () => {
    const f = forecast(company(5), S0);
    expect(f.ok).toBe(false);
  });

  it("forecasts the demo company without broken numbers", () => {
    const f = forecast(sample.months as MonthData[], { ...S, taxRate: sample.tax_rate });
    if (!f.ok) throw new Error(f.reason);
    expect(f.start).toBe("2026-10");
    for (const m of f.months) for (const v of [m.P.revenue, m.P.net_income, m.B.cash, m.W.ocf, m.revenueLow, m.revenueHigh]) expect(Number.isFinite(v)).toBe(true);
    expect(f.backtest).not.toBeNull();
  });
});

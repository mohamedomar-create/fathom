import { describe, expect, it } from "vitest";
import { analyze, bankAssessment, computeKpis, goalFor, insights, plCalc, bsCalc, realProfit, twelveMonths, type CompanySettings, type MonthData } from "@/lib/engine";
import { monthCalcs } from "@/components/analysis/metrics";

/**
 * Every figure below is worked out by hand from round numbers, using the standard definition of the measure:
 * a year of 100,000 monthly sales, cost of sales 50,000, expenses 27,000 (2,000 depreciation), interest 1,000, tax 4,950.
 */
const S: CompanySettings = { currency: "EGP", fyStartMonth: 1, taxRate: 0.225 };

function year(opts: { arGrowth?: number; drop?: string } = {}): MonthData[] {
  const out: MonthData[] = [];
  for (let t = 0; t <= 12; t++) {
    const period = t === 0 ? "2024-12" : `2025-${String(t).padStart(2, "0")}`;
    const g = (opts.arGrowth ?? 0) * t;
    out.push({
      period,
      pl: t === 0 ? {} : { revenue: 100000, cos_variable: 40000, cos_fixed: 10000, exp_variable: 5000, exp_fixed: 20000, exp_depreciation: 2000, interest_expenses: 1000, tax_expenses: 4950 },
      bs: { cash: 100000 + 19050 * t - g, ar: 150000 + g, inventory: 60000, fixed_assets: 240000 - 2000 * t, std: 50000, ap: 40000, ltd: 120000, other_equity: 100000, retained_earnings: 240000 + 17050 * t },
    });
  }
  return out.filter((m) => m.period !== opts.drop);
}

describe("standard definitions, checked by hand on a full year", () => {
  const a = analyze(year(), { type: "year", end: "2025-12" }, S);
  const K = a.K;

  it("profit and margins", () => {
    expect(a.view.B.imbalance).toBeCloseTo(0, 6);
    expect(a.view.P.ebit).toBe(276000);
    expect(a.view.P.net_income).toBeCloseTo(204600, 6);
    expect(K.gpm).toBeCloseTo(50, 9);
    expect(K.profit_ratio).toBeCloseTo(23, 9);
    expect(K.npat).toBeCloseTo(17.05, 9);
  });

  it("working-capital days use average balances and cost of sales before depreciation", () => {
    expect(K.ar_days).toBeCloseTo((150000 * 365) / 1.2e6, 9);
    expect(K.inv_days).toBeCloseTo((60000 * 365) / 600000, 9);
    expect(K.ap_days).toBeCloseTo((40000 * 365) / 600000, 9);
  });

  it("returns: ROE on opening equity, ROCE and asset turnover on average balances", () => {
    expect(K.roe).toBeCloseTo((204600 / 340000) * 100, 9);
    // Average equity 442,300 + borrowing 170,000; average assets 652,300 (13 month-ends).
    expect(K.roce).toBeCloseTo((276000 / 612300) * 100, 9);
    expect(K.asset_turn).toBeCloseTo(1.2e6 / 652300, 9);
  });

  it("interest cover is EBIT over interest expense, the same on the KPI and bank pages", () => {
    expect(K.int_cover).toBeCloseTo(23, 9);
    const bank = bankAssessment(twelveMonths(year(), "2025-12"), {}, "EGP");
    expect(bank.ratios.find((r) => r.key === "int_cover")!.value).toBeCloseTo(23, 9);
  });

  it("one operating cash flow: profit + interest + depreciation − working capital − tax change, in both views", () => {
    // 204,600 net income + 12,000 interest (under financing) + 24,000 depreciation; no working-capital change.
    expect(a.W!.ocf).toBeCloseTo(240600, 6);
    expect(a.CF!.cfo).toBeCloseTo(240600, 6);
    expect(twelveMonths(year(), "2025-12").ocf).toBeCloseTo(240600, 6);
    expect(a.W!.fcf).toBeCloseTo(240600, 6);
    expect(a.W!.ncf).toBeCloseTo(19050 * 12, 6);
    expect(a.W!.rows.find((r) => r.label === "Net Interest Paid")!.value).toBeCloseTo(-12000, 6);
  });

  it("receivable days agree across the KPI, bank and real-profit pages when receivables grow", () => {
    const m = year({ arGrowth: 10000 });
    const k = analyze(m, { type: "year", end: "2025-12" }, S).K.ar_days!;
    const b = twelveMonths(m, "2025-12");
    expect(k).toBeCloseTo(((150000 + 60000) * 365) / 1.2e6, 6);
    expect(bankAssessment(b, {}, "EGP").ratios.find((r) => r.key === "dso")!.value).toBeCloseTo(k, 6);
    expect(realProfit(b, {}).collection.dso).toBeCloseTo(k, 6);
  });

  it("a revenue target is per month: a quarter is measured against three months of it", () => {
    const q = analyze(year(), { type: "quarter", end: "2025-12" }, { ...S, targets: { total_revenue: 90000 } });
    expect(q.targets.total_revenue).toBe(270000);
    expect(q.kpiRows.find((r) => r.def.key === "total_revenue")!.ok).toBe(true);
  });
});

describe("measures with no meaning are shown as n/a, not as a misleading number", () => {
  const P = plCalc({ revenue: 100000, cos_variable: 90000, exp_fixed: 26000, interest_income: 3000, interest_expenses: 0 });
  const neg = bsCalc({ cash: 20000, ltd: 66000, retained_earnings: -56000, other_equity: 10000 });

  it("return on equity and equity change when opening equity is negative", () => {
    const k = computeKpis({ P, B: neg, B0: neg, Pprev: null, days: 30, ocf: null });
    expect(k.roe).toBeNull();
    expect(k.equity_change).toBeNull();
  });
  it("debt to equity when equity is negative", () => {
    expect(computeKpis({ P, B: neg, B0: null, Pprev: null, days: 30, ocf: null }).debt_equity).toBeNull();
  });
  it("interest cover when there is no interest expense", () => {
    expect(computeKpis({ P, B: neg, B0: null, Pprev: null, days: 30, ocf: null }).int_cover).toBeNull();
  });
});

describe("the twelve-month basis", () => {
  it("an audited annual column before monthly figures is the opening balance, not one month of sales", () => {
    const m: MonthData[] = [{ period: "2024-12", pl: { revenue: 1.2e6, cos_variable: 600000 }, bs: { cash: 100000, other_equity: 100000 } }];
    for (let t = 1; t <= 6; t++) m.push({ period: `2025-0${t}`, pl: { revenue: 100000, cos_variable: 50000 }, bs: { cash: 100000 + 50000 * t, other_equity: 100000, retained_earnings: 50000 * t } });
    const b = twelveMonths(m, "2025-06");
    expect(b.start).toBe("2025-01");
    expect(b.covered).toBe(6);
    expect(b.P.revenue).toBe(600000);
    expect(b.Pa.revenue).toBe(1.2e6);
    expect(b.B0?.cash).toBe(100000);
    expect(b.label).toBe("6 months to Jun 2025");
  });

  it("a missing month is scaled up from the months held and named", () => {
    const b = twelveMonths(year({ drop: "2025-07" }), "2025-12");
    expect(b.covered).toBe(11);
    expect(b.gaps).toEqual(["2025-07"]);
    expect(b.Pa.revenue).toBeCloseTo(1.2e6, 6);
    expect(b.label).toBe("11 months to Dec 2025 (Jul 2025 missing)");
    expect(b.ocf).toBeNull();
  });

  it("the trend view never uses a month two back as the opening balance", () => {
    const aug = monthCalcs(year({ drop: "2025-07" })).find((x) => x.period === "2025-08")!;
    expect(aug.W).toBeNull();
    expect(aug.K.asset_change).toBeNull();
  });
});

describe("plain-language findings", () => {
  it("count only the KPIs the company tracks, at the importance it set", () => {
    const m = year();
    const a = analyze(m, { type: "month", end: "2025-12" }, { ...S, activeKpis: ["gpm"], targets: { gpm: 60 } });
    const crit = a.findings.find((f) => f.title.includes("critical KPI"));
    expect(crit).toBeUndefined();
    const b = analyze(m, { type: "month", end: "2025-12" }, { ...S, activeKpis: ["gpm"], targets: { gpm: 60 }, importance: { gpm: "Critical" } });
    expect(b.findings.find((f) => f.title.includes("critical KPI"))?.text).toBe("Gross Profit Margin.");
  });

  it("speak of the period shown", () => {
    const P = plCalc({ revenue: 100, cos_variable: 80, exp_fixed: 40 });
    const B = bsCalc({ cash: 10, other_equity: 10 });
    const f = insights({ P, B, Pprev: null, K: { gpm: 20 }, W: null, tg: { gpm: 35 }, Ps: [P], Bs: [B], days: 92, status: {}, cur: "EGP", periodWord: "quarter" });
    expect(f.map((x) => x.title)).toContain("Operating loss this quarter");
    expect(f.find((x) => x.title.startsWith("Gross margin"))!.text).toContain("a quarter");
  });

  it("the goalseek stretch goal is the same on the page and in the report", () => {
    expect(goalFor(23.5, 15)).toEqual({ goal: 30, stretch: true });
    expect(goalFor(21, 15)).toEqual({ goal: 25, stretch: true });
    expect(goalFor(12, 15)).toEqual({ goal: 15, stretch: false });
  });
});

describe("devaluation", () => {
  it("30 → 50 EGP per USD: the dollar rose 66.7%, the pound lost 40%", () => {
    const b = twelveMonths(year(), "2025-12");
    const x = realProfit(b, { fxStart: 30, fxEnd: 50 });
    expect(x.fx!.devaluation).toBeCloseTo(66.6667, 3);
    expect(x.fx!.poundChange).toBeCloseTo(40, 9);
  });
});

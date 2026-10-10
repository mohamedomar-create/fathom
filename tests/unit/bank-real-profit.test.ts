import { describe, expect, it } from "vitest";
import { bankAssessment, realProfit, twelveMonths, type MonthData } from "@/lib/engine";

// Audited statements for 2024 and 2025, one column per year (as read from a bank submission file).
const months: MonthData[] = [
  { period: "2024-12",
    pl: { revenue: 9500000, cos_variable: 6500000, exp_fixed: 1700000, exp_depreciation: 250000, interest_expenses: 300000, tax_expenses: 168750 },
    bs: { fixed_assets: 2300000, inventory: 1400000, ar: 2200000, cash: 800000, other_equity: 2000000, retained_earnings: 1100000, ltd: 1000000, std: 900000, ap: 1450000, tax_liab: 250000 } },
  { period: "2025-12",
    pl: { revenue: 12000000, cos_variable: 8000000, exp_fixed: 2000000, exp_depreciation: 300000, interest_expenses: 450000, tax_expenses: 281250 },
    bs: { fixed_assets: 2500000, inventory: 1800000, ar: 3200000, cash: 600000, other_equity: 2000000, retained_earnings: 2068750, ltd: 900000, std: 1400000, ap: 1450000, tax_liab: 281250 } },
];

describe("twelve-month basis", () => {
  it("reads a single year-end column as a full year with the year before as prior", () => {
    const b = twelveMonths(months, "2025-12");
    expect(b.annualColumn).toBe(true);
    expect(b.covered).toBe(12);
    expect(b.factor).toBe(1);
    expect(b.days).toBe(365);
    expect(b.P.net_income).toBe(968750);
    expect(b.avg("ar")).toBe(2700000);
    expect(b.prior?.P.revenue).toBe(9500000);
    expect(b.ocf).toBe(-100000);
  });

  it("scales part-year books to a year and says so", () => {
    const m: MonthData[] = ["2026-01", "2026-02", "2026-03"].map((p) => ({ period: p, pl: { revenue: 100, exp_fixed: 40 }, bs: { cash: 60, other_equity: 60 } }));
    const b = twelveMonths(m, "2026-03");
    expect(b.covered).toBe(3);
    expect(b.Pa.revenue).toBe(1200);
    expect(b.label).toBe("3 months to Mar 2026");
    expect(b.B0).toBeNull();
  });
});

describe("bank readiness", () => {
  const a = bankAssessment(twelveMonths(months, "2025-12"), { rate: 25, tenor: 5, principal12m: 300000 });
  const r = (k: string) => a.ratios.find((x) => x.key === k)!;

  it("computes the ratios a credit analyst checks, with bands", () => {
    expect(r("dscr").value).toBeCloseTo(1718750 / 750000, 6);
    expect(r("dscr").band).toBe("strong");
    expect(r("debt_ebitda").value).toBeCloseTo(1.15, 6);
    expect(r("int_cover").value).toBeCloseTo(1700000 / 450000, 6);
    expect(r("current").value).toBeCloseTo(5600000 / 3131250, 6);
    expect(r("dso").value).toBeCloseTo(82.125, 6);
    expect(r("dso").band).toBe("watch");
    expect(r("ocf_ebitda").band).toBe("weak");
    expect(r("lt_funding").value).toBe(2468750);
    expect(r("rev_growth").value).toBeCloseTo(26.3158, 3);
  });

  it("raises the questions a banker would ask", () => {
    const keys = a.flags.map((f) => f.key);
    expect(keys).toContain("profit_no_cash");
    expect(keys).toContain("ar_growth");
    expect(keys).not.toContain("inv_growth");
    expect(a.flags[0].severity).toBe("high");
  });

  it("sizes extra borrowing by cover and by leverage, taking the lower", () => {
    const af = (1 - Math.pow(1.25, -5)) / 0.25;
    expect(a.capacity.byDscr).toBeCloseTo((1718750 / 1.25 - 750000) * af, 2);
    expect(a.capacity.byLeverage).toBe(3700000);
    expect(a.capacity.headroom).toBeCloseTo(a.capacity.byDscr!, 6);
  });

  it("estimates repayments from long-term loans when no schedule is given, and says so", () => {
    const e = bankAssessment(twelveMonths(months, "2025-12"), {});
    expect(e.principalEstimated).toBe(true);
    expect(e.principal12m).toBe(180000);
    expect(e.ratios.find((x) => x.key === "dscr")!.estimate).toMatch(/Enter the real figure/);
    expect(e.capacity.rateSource).toBe("implied");
  });

  it("judges growth against inflation when it is known", () => {
    const g = bankAssessment(twelveMonths(months, "2025-12"), { inflation: 30 }).ratios.find((x) => x.key === "rev_growth")!;
    expect(g.band).toBe("watch");
  });
});

describe("real profit", () => {
  const b = twelveMonths(months, "2025-12");

  it("shows cash collection and what customer credit costs, without any rates for collection", () => {
    const x = realProfit(b, {}, "EGP", 45);
    expect(x.collection.stuck).toBe(1000000);
    expect(x.collection.rate).toBeCloseTo(91.6667, 3);
    expect(x.inflation).toBeNull();
    expect(x.fx).toBeNull();
    const y = realProfit(b, { rate: 25 }, "EGP", 45);
    expect(y.collection.creditCost).toBeCloseTo(675000, 6);
    expect(y.collection.perDay).toBeCloseTo((12000000 / 365) * 0.25, 6);
    expect(y.collection.release).toBeCloseTo((82.125 - 45) * (12000000 / 365), 4);
  });

  it("bridges reported to real profit after inflation, stock replacement and depreciation", () => {
    const x = realProfit(b, { inflation: 25, fxStart: 40, fxEnd: 50, importShare: 50, assetAge: 3, rate: 25 });
    const s = Object.fromEntries(x.inflation!.steps.map((t) => [t.key, t.value]));
    expect(s.ar).toBeCloseTo(-675000, 6);
    expect(s.cash).toBeCloseTo(-175000, 6);
    expect(s.debt).toBeCloseTo(525000, 6);
    expect(s.owed).toBeCloseTo(428906.25, 6);
    expect(s.stock).toBeCloseTo(-8000000 * (Math.pow(1.25, 73 / 365) - 1), 4);
    expect(s.dep).toBeCloseTo(-285937.5, 6);
    expect(x.inflation!.real).toBeCloseTo(968750 + Object.values(s).reduce((a, v) => a + v, 0), 6);
    expect(x.inflation!.roe).toBeCloseTo(31.25, 6);
    expect(x.inflation!.realRoe).toBeCloseTo(5, 6);
    expect(x.inflation!.keepUp).toBeCloseTo(775000, 6);
  });

  it("reads the owners' result in dollars", () => {
    const x = realProfit(b, { fxStart: 40, fxEnd: 50 });
    expect(x.fx!.devaluation).toBeCloseTo(25, 6);
    expect(x.fx!.reportedUsd).toBeCloseTo(968750 / 45, 6);
    expect(x.fx!.equityChangeUsd).toBeCloseTo(4068750 / 50 - 3100000 / 40, 6);
  });
});

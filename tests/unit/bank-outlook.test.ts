import { describe, expect, it } from "vitest";
import { bankAssessment, memoText, proForma, ruleMemo, stressTest, twelveMonths, yearTrend, type MonthData } from "@/lib/engine";

// Three years of audited statements, one column per year.
const months: MonthData[] = [
  { period: "2023-12",
    pl: { revenue: 8000000, cos_variable: 5600000, exp_fixed: 1500000, exp_depreciation: 200000, interest_expenses: 250000, tax_expenses: 101250 },
    bs: { fixed_assets: 2000000, inventory: 1200000, ar: 1800000, cash: 700000, other_equity: 2000000, retained_earnings: 518750, ltd: 1100000, std: 700000, ap: 1181250, tax_liab: 200000 } },
  { period: "2024-12",
    pl: { revenue: 9500000, cos_variable: 6500000, exp_fixed: 1700000, exp_depreciation: 250000, interest_expenses: 300000, tax_expenses: 168750 },
    bs: { fixed_assets: 2300000, inventory: 1400000, ar: 2200000, cash: 800000, other_equity: 2000000, retained_earnings: 1100000, ltd: 1000000, std: 900000, ap: 1450000, tax_liab: 250000 } },
  { period: "2025-12",
    pl: { revenue: 12000000, cos_variable: 8000000, exp_fixed: 2000000, exp_depreciation: 300000, interest_expenses: 450000, tax_expenses: 281250 },
    bs: { fixed_assets: 2500000, inventory: 1800000, ar: 3200000, cash: 600000, other_equity: 2000000, retained_earnings: 2068750, ltd: 900000, std: 1400000, ap: 1450000, tax_liab: 281250 } },
];
const inputs = { rate: 25, tenor: 5, principal12m: 300000 };
const basis = twelveMonths(months, "2025-12");
const a = bankAssessment(basis, inputs);

describe("three-year trend", () => {
  const t = yearTrend(months, "2025-12", 1, inputs);
  const row = (k: string) => t.rows.find((r) => r.key === k)!;
  it("lines up the three audited years, oldest first, with the direction of the latest change", () => {
    expect(t.years.map((y) => y.end)).toEqual(["2023-12", "2024-12", "2025-12"]);
    expect(row("revenue").values).toEqual([8000000, 9500000, 12000000]);
    expect(row("revenue").direction).toBe("better");
    expect(row("debt").values).toEqual([1800000, 1900000, 2300000]);
    expect(row("debt").direction).toBe("worse");
    expect(row("dso").values[2]).toBeCloseTo(82.125 / 1.14, 6); // net of 14% VAT
    expect(row("dso").direction).toBe("worse");
  });
  it("leaves out an earlier year that is not complete", () => {
    const m: MonthData[] = [...["2025-07", "2025-08", "2025-09"], ...Array.from({ length: 12 }, (_, i) => `${i < 3 ? 2025 : 2026}-${String(((i + 9) % 12) + 1).padStart(2, "0")}`)]
      .map((p) => ({ period: p, pl: { revenue: 100, exp_fixed: 50 }, bs: { cash: 100, other_equity: 100 } }));
    const tt = yearTrend(m, "2026-09", 1);
    expect(tt.years.map((y) => y.end)).toEqual(["2026-09"]);
    expect(tt.rows[0].direction).toBeNull();
  });
});

describe("stress test", () => {
  const s = stressTest(basis, a, { taxRate: 0.225, importShare: 50, rate: 25 });
  const sc = (k: string) => s.scenarios.find((x) => x.key === k)!;
  it("re-runs the year under each shock with tax following profit", () => {
    expect(sc("base").dscr).toBeCloseTo(a.ratios.find((r) => r.key === "dscr")!.value!, 9);
    expect(sc("sales10").dscr).toBeCloseTo((1600000 - 191250) / 750000, 9);
    expect(sc("rates").dscr).toBeCloseTo((2000000 - 267075) / 813000, 9);
    expect(sc("fx").dscr).toBeCloseTo((1000000 - 56250) / 750000, 9);
    expect(sc("fx").band).toBe("pass");
    const extra = (12000000 / 365) * 30;
    expect(sc("dso").extraCash).toBeCloseTo(extra, 6);
    expect(sc("dso").dscr).toBeCloseTo((2000000 - (281250 - 0.225 * extra * 0.25)) / (750000 + extra * 0.25), 9);
  });
  it("finds the breaking points where cover falls to 1.0x", () => {
    expect(s.maxSalesFall).toBeCloseTo(31.25, 6);
    expect(s.maxRateRise).toBeCloseTo(968750 / 16275, 6);
  });
  it("skips the devaluation scenario until the imported share is known", () => {
    const n = stressTest(basis, a, { taxRate: 0.225, rate: 25 });
    expect(n.scenarios.some((x) => x.key === "fx")).toBe(false);
    expect(n.notes.join(" ")).toMatch(/imported share/);
  });
});

describe("the loan being asked for", () => {
  it("tests a term loan against cover and leverage, and finds the tenor that would fit", () => {
    const af = (1 - Math.pow(1.25, -5)) / 0.25;
    const p = proForma(basis, a, { amount: 3000000, type: "term_loan" }, 25, 5);
    expect(p.payment).toBeCloseTo(3000000 / af, 6);
    expect(p.dscr).toBeCloseTo(1718750 / (750000 + 3000000 / af), 9);
    expect(p.debtEbitda).toBeCloseTo(2.65, 9);
    expect(p.icr).toBeCloseTo(1700000 / 1200000, 9);
    expect(p.fits).toBe(false);
    expect(p.excess).toBeCloseTo(3000000 - a.capacity.headroom!, 6);
    expect(p.tenorNeeded).toBeNull();
    expect(proForma(basis, a, { amount: 2000000, type: "term_loan" }, 25, 5).tenorNeeded).toBe(8);
  });
  it("treats a working-capital line as interest only and an LC as no cash payment", () => {
    const w = proForma(basis, a, { amount: 1000000, type: "working_capital" }, 25, 5);
    expect(w.payment).toBe(250000);
    expect(w.fits).toBe(true);
    const lc = proForma(basis, a, { amount: 1000000, type: "lc_guarantee" }, 25, 5);
    expect(lc.payment).toBe(0);
    expect(lc.debtEbitda).toBeCloseTo(1.15, 9);
  });
});

describe("automatic bank memo", () => {
  it("leads with strengths, names the weak point and the request", () => {
    const pf = proForma(basis, a, { amount: 2000000, type: "term_loan" }, 25, 5);
    const m = ruleMemo("Delta Trading", a, { stress: stressTest(basis, a, { taxRate: 0.225, rate: 25 }), pf, trend: yearTrend(months, "2025-12", 1, inputs), cur: "EGP", purpose: "a new warehouse" });
    expect(m.headline).toMatch(/EGP 2,000,000 requested goes beyond common limits; the figures support about EGP 1,680,800, or the full amount repaid over 8 years/);
    expect(ruleMemo("Delta Trading", a, { cur: "EGP" }).headline).toMatch(/Debt service cover \(DSCR\) and .* support the application; prepare for questions on cash conversion/);
    expect(m.lead.join(" ")).toMatch(/Debt service cover/);
    expect(m.lead.join(" ")).toMatch(/sales could fall 31%/);
    expect(m.risks[0].risk).toMatch(/Profit but no cash left after interest/);
    expect(m.ask[0]).toMatch(/EGP 2,000,000 term loan .* for a new warehouse/);
    expect(m.ask[0]).toMatch(/Repaying over 8 years/);
    const text = memoText(m);
    expect(text).toMatch(/\n\nLead with\n• /);
    expect(text).toMatch(/Questions to expect/);
  });
});

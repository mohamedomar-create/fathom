import { describe, expect, it } from "vitest";
import sample from "../../reference/sample.json";
import {
  analyze, applyChanges, breakeven, kpiStatus, leverNeeded, money, num, pct, periodView, plCalc, selectableEnds, windowFor, type MonthData,
} from "@/lib/engine";

// Blueprint §9 worked example (one month, 30 days, t = 22.5%).
const P = plCalc({
  revenue: 1_000_000, cos_variable: 545_000, cos_depreciation: 5_000, exp_variable: 50_000, exp_fixed: 245_000,
  other_income: 10_000, other_expenses: 30_000, interest_income: 1_000, interest_expenses: 21_000, tax_expenses: 25_000,
});

describe("blueprint §9 acceptance numbers", () => {
  it("P&L cascade", () => {
    expect(P.gross_profit).toBe(450_000);
    expect(P.operating_profit).toBe(155_000);
    expect(P.ebit).toBe(135_000);
    expect(P.ebt).toBe(115_000);
    expect(P.eat).toBe(90_000);
  });
  it("breakeven 617,284 and margin of safety 382,716", () => {
    const b = breakeven(P);
    if (!b.ok) throw new Error("expected breakeven");
    expect(Math.round(b.bep)).toBe(617_284);
    expect(Math.round(b.mos)).toBe(382_716);
    expect(b.vcr).toBeCloseTo(0.595, 12);
    expect(b.revenue - b.variableCosts - b.fixedCosts).toBe(P.operating_profit);
  });
  it("goalseek to 15%: price +1.76%, volume +5.88%, variable COS −2.75%, fixed expenses −6.12%", () => {
    expect(leverNeeded(P, "profit_ratio", 15, "price")!.toFixed(2)).toBe("1.76");
    expect(leverNeeded(P, "profit_ratio", 15, "volume")!.toFixed(2)).toBe("5.88");
    expect(leverNeeded(P, "profit_ratio", 15, "cos_variable")!.toFixed(2)).toBe("-2.75");
    expect(leverNeeded(P, "profit_ratio", 15, "exp_fixed")!.toFixed(2)).toBe("-6.12");
  });
  it("each single lever, applied alone, lands exactly on the goal", () => {
    for (const k of ["price", "volume", "cos_variable", "exp_fixed", "exp_variable", "other_expenses", "other_income"] as const) {
      const need = leverNeeded(P, "profit_ratio", 15, k)!;
      expect(applyChanges(P, "profit_ratio", { [k]: need })!).toBeCloseTo(15, 9);
    }
    for (const k of ["price", "volume", "cos_variable"] as const) {
      expect(applyChanges(P, "gpm", { [k]: leverNeeded(P, "gpm", 50, k)! })!).toBeCloseTo(50, 9);
    }
  });
  it("GPM 45% vs 35% target is on track, +10 pp", () => {
    const s = kpiStatus(45, 35, "up", "%");
    expect(s.ok).toBe(true);
    expect(s.trend!.value).toBe(10);
  });
});

describe("formatting mirrors the reference", () => {
  it("money / pct / num", () => {
    expect(money(-140270, "¤")).toBe("-¤ 140,270");
    expect(money(1234567, "EGP", true)).toBe("EGP 1.2M");
    expect(money(45300, "EGP", true)).toBe("EGP 45K");
    expect(pct(45)).toBe("45%");
    expect(pct(12.5)).toBe("12.5%");
    expect(pct(13.456)).toBe("13.46%");
    expect(num(2, "ratio")).toBe("2:1");
    expect(num(1.5, "ratio")).toBe("1.50:1");
    expect(num(3, "times")).toBe("3 times");
    expect(num(44.6, "days")).toBe("45 days");
  });
});

const months = sample.months as MonthData[];
const settings = { currency: "EGP", fyStartMonth: 1, taxRate: 0.225, targets: sample.targets };

describe("quarter and year aggregation", () => {
  it("windows follow the financial year", () => {
    expect(windowFor({ type: "quarter", end: "2026-09" }, 1).periods).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(windowFor({ type: "quarter", end: "2026-08" }, 1).label).toBe("Q3 2026 (to Aug)");
    expect(windowFor({ type: "quarter", end: "2026-09" }, 7).label).toBe("Q1 FY2027");
    expect(windowFor({ type: "year", end: "2026-09" }, 7).periods).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(windowFor({ type: "year", end: "2026-06" }, 7).periods.length).toBe(12);
  });
  it("Q3 2026 sums P&L, takes closing BS of Sep and opening BS of Jun", () => {
    const v = periodView(months, { type: "quarter", end: "2026-09" }, 1);
    const byP = Object.fromEntries(months.map((m) => [m.period, m]));
    const rev = ["2026-07", "2026-08", "2026-09"].reduce((s, p) => s + byP[p].pl.revenue!, 0);
    expect(v.P.revenue).toBe(rev);
    expect(v.B.cash).toBe(byP["2026-09"].bs.cash);
    expect(v.B0!.cash).toBe(byP["2026-06"].bs.cash);
    expect(v.days).toBe(92);
    expect(v.prior!.P.revenue).toBe(["2026-04", "2026-05", "2026-06"].reduce((s, p) => s + byP[p].pl.revenue!, 0));
    expect(v.ly).toBeNull(); // Jul 2025 is not loaded
  });
  it("quarter analysis reconciles: NCF = ΔCash − ΔDebt and indirect statement = ΔCash", () => {
    const a = analyze(months, { type: "quarter", end: "2026-09" }, settings);
    expect(Math.abs(a.W!.ncf - (a.W!.dcash - a.W!.ddebt))).toBeLessThan(0.5);
    expect(Math.abs(a.CF!.cfo + a.CF!.cfi + a.CF!.cff - a.CF!.dcash)).toBeLessThan(0.5);
    // AR days use the 92 days of the quarter and the quarter's revenue
    expect(a.K.ar_days).toBeCloseTo((a.view.B.ar * 92) / a.view.P.revenue, 9);
  });
  it("year-to-date 2026 starts in January with Dec 2025 as opening", () => {
    const v = periodView(months, { type: "year", end: "2026-09" }, 1);
    expect(v.window.periods.length).toBe(9);
    expect(v.B0!.cash).toBe(months.find((m) => m.period === "2025-12")!.bs.cash);
    expect(v.ytd.revenue).toBe(v.P.revenue);
  });
  it("same month last year compares Sep 2026 with Sep 2025", () => {
    const v = periodView(months, { type: "month", end: "2026-09" }, 1);
    expect(v.ly!.P.revenue).toBe(months.find((m) => m.period === "2025-09")!.pl.revenue);
  });
  it("first month has no opening balance → no cash flow, n/a ROE", () => {
    const a = analyze(months, { type: "month", end: "2025-08" }, settings);
    expect(a.W).toBeNull();
    expect(a.K.roe).toBeNull();
  });
  it("selectable quarters and years", () => {
    expect(selectableEnds(months, "quarter", 1).map((x) => x.label)).toEqual([
      "Q3 2025", "Q4 2025", "Q1 2026", "Q2 2026", "Q3 2026",
    ]);
    expect(selectableEnds(months, "year", 1).map((x) => x.label)).toEqual(["Year 2025", "Year 2026 (to Sep)"]);
  });
});

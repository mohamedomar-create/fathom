import { describe, expect, it } from "vitest";
import { addMonths, analyze, forecast, isAnnualColumn, periodView, twelveMonths, type MonthData } from "@/lib/engine";

// Made-up steady business: revenue 100k a month, cost of sales 60k, receivables 150k (about 45 days).
const month = (period: string, scale = 1, extra: Partial<MonthData["pl"]> = {}): MonthData => ({
  period,
  pl: { revenue: 100_000 * scale, cos_variable: 60_000 * scale, exp_fixed: 20_000 * scale, ...extra },
  bs: { cash: 500_000, ar: 150_000, inventory: 200_000, ap: 100_000, other_equity: 500_000, retained_earnings: 250_000 },
});
const run = (from: string, n: number) => Array.from({ length: n }, (_, i) => month(addMonths(from, i)));
const SET = { currency: "EGP", fyStartMonth: 1, taxRate: 0.225 };

describe("periods with months missing", () => {
  it("a year holding only Oct–Dec measures days on those three months, not the whole year", () => {
    const ms = run("2024-10", 15);
    const part = analyze(ms, { type: "year", end: "2024-12" }, SET);
    const full = analyze(ms, { type: "year", end: "2025-12" }, SET);
    const ar = (a: typeof part) => a.K.ar_days!;
    expect(ar(part)).toBeGreaterThan(40);
    expect(ar(part)).toBeLessThan(50);
    expect(Math.abs(ar(part) - ar(full))).toBeLessThan(3);
  });

  it("a revenue target for a year holding three months is scaled by three, not twelve", () => {
    const ms = run("2024-10", 15);
    const a = analyze(ms, { type: "year", end: "2024-12" }, { ...SET, targets: { total_revenue: 100_000 } } as never);
    expect(a.targets.total_revenue).toBe(300_000);
  });
});

describe("annual columns", () => {
  it("the first month of monthly data that falls on a year-end is a month, not a year", () => {
    const ms = run("2024-12", 13);
    expect(isAnnualColumn(ms, "2024-12", 1)).toBe(false);
    expect(periodView(ms, { type: "month", end: "2024-12" }, 1).annual).toBe(false);
    expect(twelveMonths(ms, "2025-11", 1)).toMatchObject({ covered: 12, annualColumn: false });
  });

  it("a year-end column twelve times the months after it is still an audited year", () => {
    const ms = [month("2024-12", 12), ...run("2025-01", 9)];
    expect(isAnnualColumn(ms, "2024-12", 1)).toBe(true);
  });

  it("an annual year compared with a monthly prior year sums all twelve prior months", () => {
    const ms = [...run("2024-01", 12).map((m) => (m.period === "2024-12" ? m : m)), month("2025-12", 12)];
    const v = periodView(ms, { type: "year", end: "2025-12" }, 1);
    expect(v.annual).toBe(true);
    expect(v.ly?.P.revenue).toBe(1_200_000);
  });

  it("the forecast starts its history after an annual column", () => {
    const ms = [month("2024-12", 12, { interest_expenses: 12_000, other_income: 60_000 }), ...run("2025-01", 9).map((m) => ({ ...m, pl: { ...m.pl, interest_expenses: 1_000 } }))];
    const f = forecast(ms, SET as never);
    if (!f.ok) throw new Error(f.reason);
    const pl = f.months[0].pl;
    expect(Math.round(pl.other_income ?? 0)).toBe(0);
  });
});

describe("a month still in progress", () => {
  it("the twelve months to a part month count the days actually covered", () => {
    const ms = run("2025-11", 12);
    const b = twelveMonths(ms, "2026-10", 1, "2026-10-10");
    expect(b.days).toBe(365 - 21);
    expect(Math.round(b.Pa.revenue)).toBeGreaterThan(1_190_000);
  });
});

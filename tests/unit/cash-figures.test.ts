import { describe, expect, it } from "vitest";
import { cashFigures, cashForecast, cashSummary, CASH_DEFS, type Entry } from "@/lib/cash/figures";

const e = (day: string, direction: "in" | "out", amount: number, more: Partial<Entry> = {}): Entry =>
  ({ day, direction, amount, category: "", party: "", paid: null, paidOn: null, ...more });

// Jan: in 1,000 + 500, out 1,200 + 300 → net 0. Feb: in 3,500, out 1,200 → 2,300. Mar: in 1,000, out 1,300 → −300.
const BOOK: Entry[] = [
  e("2026-01-05", "in", 1000, { category: "Drinks", party: "Nile", paid: true, paidOn: "2026-01-10" }),
  e("2026-01-20", "in", 500, { category: "Snacks", party: "Delta", paid: false }),
  e("2026-01-01", "out", 1200, { category: "Rent", paid: true }),
  e("2026-01-15", "out", 300, { category: "Ice", paid: false }),
  e("2026-02-03", "in", 2000, { category: "Drinks", party: "Nile", paid: true }),
  e("2026-02-20", "in", 1500, { category: "Drinks", party: "Giza", paid: true }),
  e("2026-02-01", "out", 1200, { category: "Rent", paid: true }),
  e("2026-03-14", "in", 1000, { category: "Snacks", party: "Giza", paid: true, paidOn: "2026-04-02" }),
  e("2026-03-01", "out", 1200, { category: "Rent", paid: true }),
  e("2026-03-15", "out", 100, { category: "", paid: true }),
];
const TODAY = "2026-04-15";

describe("money in and out", () => {
  const f = cashFigures(BOOK, { opening: null, today: TODAY, range: "all" });
  it("each month, gaps as zero", () => {
    expect(f.months.map((m) => [m.period, m.in, m.out, m.net])).toEqual([["2026-01", 1500, 1500, 0], ["2026-02", 3500, 1200, 2300], ["2026-03", 1000, 1300, -300]]);
  });
  it("totals for the range, and net as a share of money in", () => {
    expect([f.total.in, f.total.out, f.total.net]).toEqual([6000, 4000, 2000]);
    expect(f.total.netPct).toBeCloseTo(33.3333, 3);
  });
  it("the last 3 months against the 3 before: needs those months", () => {
    const g = cashFigures(BOOK, { opening: null, today: TODAY, range: "3m" });
    expect(g.change).toEqual({ ok: false, needs: "earlier_months" });
    const m = cashFigures(BOOK, { opening: null, today: TODAY, range: "month" });
    expect(m.periods).toEqual(["2026-03"]);
    expect(m.change).toEqual({ ok: true, value: ((1000 - 3500) / 3500) * 100 });
  });
  it("average money in per selling day", () => {
    expect(f.avgDay).toEqual({ ok: true, value: 6000 / 5 });
  });
  it("best and worst months by net", () => {
    expect(f.best).toEqual({ ok: true, value: { period: "2026-02", net: 2300 } });
    expect(f.worst).toEqual({ ok: true, value: { period: "2026-03", net: -300 } });
  });
  it("by category, blank as Other, largest first", () => {
    expect(f.inBy).toEqual([{ name: "Drinks", amount: 4500 }, { name: "Snacks", amount: 1500 }]);
    expect(f.outBy).toEqual([{ name: "Rent", amount: 3600 }, { name: "Ice", amount: 300 }, { name: "Other", amount: 100 }]);
  });
  it("top customers only when the sheet names them", () => {
    expect(f.parties).toEqual({ ok: true, value: [{ name: "Nile", amount: 3000 }, { name: "Giza", amount: 2500 }, { name: "Delta", amount: 500 }] });
    expect(cashFigures([e("2026-01-01", "in", 5)], { opening: null, today: TODAY, range: "all" }).parties).toEqual({ ok: false, needs: "names" });
  });
});

describe("cash balance", () => {
  it("needs the opening cash", () => {
    expect(cashFigures(BOOK, { opening: null, today: TODAY, range: "all" }).cash).toEqual({ ok: false, needs: "opening_cash" });
  });
  it("opening + money that moved since (unpaid not yet; paid on its payment day)", () => {
    const f = cashFigures(BOOK, { opening: { amount: 10000, asOf: "2025-12-31" }, today: TODAY, range: "all" });
    // In: 1,000 + 2,000 + 1,500 + 1,000 (paid 2 Apr) = 5,500. Out: 1,200 × 3 + 100 = 3,700. Unpaid 500 in and 300 out left out.
    expect(f.cash).toEqual({ ok: true, value: 11800 });
    expect(f.balances.map((b) => [b.period, b.balance])).toEqual([["2026-01", 9800], ["2026-02", 12100], ["2026-03", 10800], ["2026-04", 11800]]);
  });
});

describe("unpaid", () => {
  it("money owed to and by the business, by age from its day", () => {
    const f = cashFigures(BOOK, { opening: null, today: TODAY, range: "all" });
    expect(f.unpaidIn).toEqual({ ok: true, value: { total: 500, buckets: [0, 0, 500, 0] } });
    expect(f.unpaidOut).toEqual({ ok: true, value: { total: 300, buckets: [0, 0, 300, 0] } });
  });
  it("needs a Paid column", () => {
    expect(cashFigures([e("2026-01-01", "in", 5)], { opening: null, today: TODAY, range: "all" }).unpaidIn).toEqual({ ok: false, needs: "paid_column" });
  });
});

describe("next three months", () => {
  it("the average of the last 3 complete months", () => {
    const f = cashForecast(cashFigures(BOOK, { opening: null, today: TODAY, range: "all" }).months, TODAY);
    expect(f).toEqual({ ok: true, value: { method: "average", points: [
      { period: "2026-04", in: 2000, out: 4000 / 3, net: 2000 / 3 }, { period: "2026-05", in: 2000, out: 4000 / 3, net: 2000 / 3 }, { period: "2026-06", in: 2000, out: 4000 / 3, net: 2000 / 3 },
    ] } });
  });
  it("with a year of months: last year's same month, grown by the recent change", () => {
    // 15 months: money in 100 a month in 2025, 120 a month in 2026 (Jan–Mar); April 2025 was 200.
    const months = Array.from({ length: 15 }, (_, i) => {
      const p = `${2025 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
      const v = p === "2025-04" ? 200 : p >= "2026-01" ? 120 : 100;
      return { period: p, in: v, out: 0, net: v };
    });
    const f = cashForecast(months, "2026-04-10");
    if (!f.ok) throw new Error("expected a forecast");
    expect(f.value.method).toBe("last_year");
    // Last 3 months 360 against the same 3 a year before 300: × 1.2. April 2025 was 200 → 240.
    expect(f.value.points[0]).toEqual({ period: "2026-04", in: 240, out: 0, net: 240 });
  });
  it("needs 3 complete months", () => {
    expect(cashForecast([{ period: "2026-03", in: 1, out: 0, net: 1 }], TODAY)).toEqual({ ok: false, needs: "three_months" });
  });
});

describe("in short", () => {
  it("3–5 sentences, each with its numbers", () => {
    const s = cashSummary(cashFigures(BOOK, { opening: { amount: 10000, asOf: "2025-12-31" }, today: TODAY, range: "all" }), "EGP");
    expect(s.length).toBeGreaterThanOrEqual(3);
    expect(s.length).toBeLessThanOrEqual(5);
    for (const x of s) expect(x).toMatch(/\d/);
    expect(cashSummary(cashFigures([], { opening: null, today: TODAY, range: "all" }), "EGP")).toEqual([]);
  });
  it("every figure has a formula", () => {
    for (const d of CASH_DEFS) { expect(d.formula.length).toBeGreaterThan(5); expect(d.ar.formula.length).toBeGreaterThan(5); }
  });
});

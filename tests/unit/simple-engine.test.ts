import { describe, expect, it } from "vitest";
import type { SalesLine } from "@/lib/ingest/sales";
import type { ExpenseLine } from "@/lib/ingest/expenses";
import {
  ageByDate, cashLines, concentration, forecastSeries, seasonality, simpleFindings, simplePL, simpleSummary, SIMPLE_DEFS,
} from "@/lib/engine/simple";

const sale = (day: string, customer: string, amount: number, cost: number | null, paid?: boolean | null, paidOn?: string | null): SalesLine => ({
  day, period: day.slice(0, 7), doc: "", series: "", customer, product: "", category: "", salesperson: "", qty: null, amount, cost,
  ...(paid !== undefined ? { paid } : {}), ...(paidOn ? { paidOn } : {}),
});
const exp = (day: string, category: string, cls: ExpenseLine["cls"], amount: number, paid?: boolean | null): ExpenseLine => ({
  day, period: day.slice(0, 7), doc: "", series: "", supplier: "", account: category, cls, category, label: "", amount,
  ...(paid !== undefined ? { paid } : {}),
});

// A worked quarter. Revenue Jan 1,500 · Feb 3,500 · Mar 1,000; cost of sales 40% on every line.
const SALES: SalesLine[] = [
  sale("2026-01-10", "A", 1000, 400, true, "2026-01-20"),
  sale("2026-01-15", "B", 500, 200, false),
  sale("2026-02-05", "A", 2000, 800, true),
  sale("2026-02-20", "C", 1500, 600),
  sale("2026-03-10", "A", 1000, 400, true, "2026-04-02"),
];
const EXPENSES: ExpenseLine[] = [
  exp("2026-01-01", "Rent", "exp_fixed", 1200, true),
  exp("2026-01-25", "Ads", "exp_variable", 300, false),
  exp("2026-02-01", "Rent", "exp_fixed", 1200, true),
  exp("2026-03-01", "Rent", "exp_fixed", 1200, true),
  exp("2026-03-15", "Supplies", "cos_variable", 100, true),
];
const OPENING = { amount: 10000, asOf: "2025-12-31" };
const AS_OF = "2026-04-15";

describe("Simple P&L from lines (reuses plCalc, sumPL, breakeven)", () => {
  const pl = simplePL(SALES, EXPENSES);
  it("builds each month from the lines", () => {
    expect(pl.months.map((m) => m.period)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(pl.months.map((m) => m.P.revenue)).toEqual([1500, 3500, 1000]);
    expect(pl.months.map((m) => m.P.net_income)).toEqual([-600, 900, -700]);
  });
  it("cost of sale comes only from the Sales sheet: an expense classed as cost of sales counts as a variable expense", () => {
    expect(pl.months[2].P.cos_variable).toBe(400);
    expect(pl.months[2].P.exp_variable).toBe(100);
  });
  it("totals, net margin, gross margin and break-even for the quarter", () => {
    const t = pl.total;
    expect(t.revenue).toBe(6000);
    expect(t.net_income).toBe(-400);
    expect(pl.netMargin).toBeCloseTo(-6.6667, 3);
    expect(pl.grossMargin).toEqual({ ok: true, value: 60 });
    expect(pl.breakeven).toMatchObject({ ok: true, bep: 6750 });
  });
  it("gross margin needs the cost column on every sale; a partial column says how much is covered", () => {
    const part = simplePL([sale("2026-01-10", "A", 1000, 400), sale("2026-01-11", "A", 3000, null)], []);
    expect(part.grossMargin).toEqual({ ok: false, needs: "cost_column", covered: 25 });
    expect(part.total.cos_variable).toBe(400);
    const none = simplePL([sale("2026-01-10", "A", 1000, null)], []);
    expect(none.grossMargin).toEqual({ ok: false, needs: "cost_column", covered: 0 });
  });
  it("a window keeps only its months", () => {
    expect(simplePL(SALES, EXPENSES, ["2026-02"]).total.revenue).toBe(3500);
  });
});

describe("cash from lines", () => {
  const c = cashLines(SALES, EXPENSES, OPENING, AS_OF);
  it("paid lines on their payment day, paid without a day on their own day, unpaid not yet cash, blank assumed paid", () => {
    expect(c.months.map((m) => [m.period, m.in, m.out, m.net])).toEqual([
      ["2026-01", 1000, 1200, -200], ["2026-02", 3500, 1200, 2300], ["2026-03", 0, 1300, -1300], ["2026-04", 1000, 0, 1000],
    ]);
    expect(c.assumedPaid).toEqual({ lines: 1, amount: 1500 });
  });
  it("the balance runs from the opening cash", () => {
    expect(c.months.map((m) => m.balance)).toEqual([9800, 12100, 10800, 11800]);
    expect(c.balance).toEqual({ ok: true, value: 11800 });
  });
  it("a business taking in more than it spends is not burning cash: no runway figure", () => {
    expect(c.burn).toEqual({ ok: true, value: 0 });
    expect(c.runway).toEqual({ ok: false, needs: "not_burning" });
  });
  it("burn is the average net cash out of the last three complete months; runway = cash ÷ burn", () => {
    const s = ["01", "02", "03"].map((m) => sale(`2026-${m}-05`, "A", 400, null, true));
    const e = ["01", "02", "03"].map((m) => exp(`2026-${m}-06`, "Rent", "exp_fixed", 1000, true));
    const b = cashLines(s, e, { amount: 6000, asOf: "2025-12-31" }, "2026-04-10");
    expect(b.burn).toEqual({ ok: true, value: 600 });
    expect(b.balance).toEqual({ ok: true, value: 4200 });
    expect(b.runway).toEqual({ ok: true, value: 7 });
  });
  it("movements on or before the opening-cash date are already in it", () => {
    const b = cashLines([sale("2026-01-05", "A", 500, null, true)], [], { amount: 1000, asOf: "2026-01-10" }, "2026-02-01");
    expect(b.balance).toEqual({ ok: true, value: 1000 });
  });
  it("no opening cash: in and out still show, the balance and runway say what they need", () => {
    const b = cashLines(SALES, EXPENSES, null, AS_OF);
    expect(b.months[0].net).toBe(-200);
    expect(b.balance).toEqual({ ok: false, needs: "opening_cash" });
    expect(b.runway).toEqual({ ok: false, needs: "opening_cash" });
  });
});

describe("ageing by date", () => {
  it("0–30, 31–60, 61–90, 90+ days from the invoice or bill day", () => {
    const a = ageByDate([
      { day: "2026-04-15", amount: 1 }, { day: "2026-03-16", amount: 2 }, { day: "2026-03-15", amount: 4 },
      { day: "2026-01-15", amount: 8 }, { day: "2026-01-14", amount: 16 },
    ], AS_OF);
    expect(a.buckets).toEqual([3, 4, 8, 16]);
    expect(a.total).toBe(31);
    expect(a.overdue90).toBe(16);
  });
  it("unpaid sales are receivables and unpaid expenses payables; without the paid column there is nothing to age", () => {
    const s = simpleSummary({ sales: SALES, expenses: EXPENSES, openingCash: OPENING, asOf: AS_OF });
    expect(s.receivables).toMatchObject({ ok: true, value: { total: 500, buckets: [0, 0, 500, 0] } });
    expect(s.payables).toMatchObject({ ok: true, value: { total: 300, buckets: [0, 0, 300, 0] } });
    const bare = simpleSummary({ sales: [sale("2026-01-10", "A", 1000, null)], expenses: [], openingCash: null, asOf: AS_OF });
    expect(bare.receivables).toEqual({ ok: false, needs: "paid_column" });
  });
});

describe("customer concentration", () => {
  it("top-1 and top-5 shares of revenue", () => {
    expect(concentration(SALES)).toEqual({ ok: true, value: { top1: { name: "A", share: (4000 / 6000) * 100 }, top5: 100, customers: 3 } });
  });
  it("needs customer names", () => {
    expect(concentration([sale("2026-01-10", "No customer", 1000, null)])).toEqual({ ok: false, needs: "customers" });
    expect(concentration([sale("2026-01-10", "", 1000, null)])).toEqual({ ok: false, needs: "customers" });
  });
});

describe("seasonality", () => {
  const rev = Array.from({ length: 24 }, (_, i) => {
    const period = `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
    return { period, value: period.endsWith("-12") ? 200 : 100 };
  });
  it("each calendar month ÷ the average month, with the peak and low", () => {
    const s = seasonality(rev);
    if (!s.ok) throw new Error("expected seasonality");
    expect(s.value.index[11]).toBeCloseTo(200 / (1300 / 12), 6);
    expect(s.value.index[0]).toBeCloseTo(100 / (1300 / 12), 6);
    expect(s.value.peak).toBe(12);
  });
  it("needs twelve months", () => {
    expect(seasonality(rev.slice(0, 11))).toEqual({ ok: false, needs: "twelve_months" });
  });
});

describe("forecast series (the Full forecast's revenue methods, chosen by backtest)", () => {
  const flat = Array.from({ length: 12 }, (_, i) => ({ period: `2025-${String(i + 1).padStart(2, "0")}`, value: 1000 }));
  it("a flat history forecasts flat, with the method and its tested error shown", () => {
    const f = forecastSeries(flat, 6);
    if (!f.ok) throw new Error("expected a forecast");
    expect(f.value.points.map((p) => p.period)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]);
    for (const p of f.value.points) { expect(p.value).toBeCloseTo(1000, 0); expect(p.low).toBeLessThanOrEqual(p.value); expect(p.high).toBeGreaterThanOrEqual(p.value); }
    expect(f.value.backtestError).toBeCloseTo(0, 6);
    expect(f.value.methodLabel.length).toBeGreaterThan(0);
  });
  it("the horizon is kept to 3–6 months", () => {
    const f = forecastSeries(flat, 12);
    expect(f.ok && f.value.points.length).toBe(6);
    const g = forecastSeries(flat, 1);
    expect(g.ok && g.value.points.length).toBe(3);
  });
  it("needs three months", () => {
    expect(forecastSeries(flat.slice(0, 2), 3)).toEqual({ ok: false, needs: "three_months" });
  });
});

describe("plain-language summary and definitions", () => {
  it("3–5 bullets, each carrying its numbers", () => {
    const s = simpleSummary({ sales: SALES, expenses: EXPENSES, openingCash: OPENING, asOf: AS_OF });
    const b = simpleFindings(s, "EGP");
    expect(b.length).toBeGreaterThanOrEqual(3);
    expect(b.length).toBeLessThanOrEqual(5);
    for (const x of b) expect(x).toMatch(/\d/);
  });
  it("every Simple figure has a formula and a definition", () => {
    for (const d of SIMPLE_DEFS) { expect(d.formula.length).toBeGreaterThan(5); expect(d.about.length).toBeGreaterThan(5); }
    expect(SIMPLE_DEFS.map((d) => d.key)).toEqual(expect.arrayContaining(["revenue", "net_profit", "net_margin", "gross_margin", "cash", "burn", "runway", "breakeven", "top1", "top5", "seasonality", "receivables", "payables"]));
  });
});

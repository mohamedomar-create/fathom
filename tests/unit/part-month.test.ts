import { describe, expect, it } from "vitest";
import { periodView, analyze, type MonthData, type CompanySettings } from "@/lib/engine";
import { monthCalcs } from "@/components/analysis/metrics";

// Three whole months and a part month (books to 10 October): revenue 3,000 a month, 1,000 so far in October.
const m = (period: string, revenue: number, ar: number): MonthData => ({ period, pl: { revenue, exp_fixed: revenue * 0.5 }, bs: { cash: 1000, ar, retained_earnings: 1000 + ar } } as MonthData);
const months = [m("2025-10", 3000, 900), m("2026-07", 3000, 900), m("2026-08", 3000, 900), m("2026-09", 3000, 900), m("2026-10", 1000, 900)];
const settings = { fyStartMonth: 1, currency: "EGP" } as unknown as CompanySettings;

describe("a part month is the same everywhere", () => {
  it("the view counts only the days covered and says so", () => {
    const v = periodView(months, { type: "month", end: "2026-10" }, 1, "2026-10-10");
    expect(v.days).toBe(10);
    expect(v.partDay).toBe(10);
    expect(v.window.label).toBe("Oct 2026 (to 10 Oct)");
  });
  it("last month and last year are compared on the same days", () => {
    const v = periodView(months, { type: "month", end: "2026-10" }, 1, "2026-10-10");
    expect(v.prior!.P.revenue).toBeCloseTo(1000, 6); // 3,000 × 10/30 (September)
    expect(v.ly!.P.revenue).toBeCloseTo(3000 * 10 / 31, 6); // October 2025
    expect(v.prior!.label).toContain("same 10 days");
  });
  it("without a cut-off, nothing changes", () => {
    const v = periodView(months, { type: "month", end: "2026-09" }, 1);
    expect(v.days).toBe(30);
    expect(v.prior!.P.revenue).toBe(3000);
  });
  it("the KPI comparison column is like for like too", () => {
    const a = analyze(months, { type: "month", end: "2026-10" }, settings, { comparison: "prior", asOf: "2026-10-10" });
    const row = a.kpiRows.find((r) => r.def.key === "total_revenue")!;
    expect(row.value).toBe(1000);
    expect(row.compare).toBeCloseTo(1000, 6);
  });
  it("the monthly table counts a part month's debtor days on its days", () => {
    const c = monthCalcs(months, "2026-10-10");
    const oct = c.find((x) => x.period === "2026-10")!, sep = c.find((x) => x.period === "2026-09")!;
    // Same receivables and the same daily sales: the same debtor days.
    expect(oct.K.ar_days).toBeCloseTo(sep.K.ar_days!, 6);
  });
});

describe("pages open on the last full month", () => {
  it("a part month at the end is skipped; it stays one click away", async () => {
    const { defaultEnd } = await import("@/lib/engine/period");
    const ps = ["2026-08", "2026-09", "2026-10"];
    expect(defaultEnd(ps, "2026-10-10")).toBe("2026-09");
    expect(defaultEnd(ps, "2026-10-31")).toBe("2026-10");
    expect(defaultEnd(ps, null)).toBe("2026-10");
    // Only a part month: it is all there is.
    expect(defaultEnd(["2026-10"], "2026-10-10")).toBe("2026-10");
    expect(defaultEnd([], null)).toBeUndefined();
  });
});

describe("Sales and Expenses grow against the same days", () => {
  const line = (period: string, amount: number) => ({ period, doc: `INV/${period}`, series: "INV", customer: "A", product: "P", category: "C", salesperson: "", qty: 1, amount, cost: null });
  it("10 days of October at September's daily rate is no change, not 'down 67%'", async () => {
    const { summariseSales, salesAnalysis } = await import("@/lib/engine/sales");
    const d = summariseSales([line("2026-09", 3000), line("2026-10", 1000)]);
    const s = salesAnalysis(d, { type: "month", end: "2026-10" }, 1, { asOf: "2026-10-10" });
    expect(s.compare).toBeCloseTo(1000, 6);
    expect(s.growth).toBeCloseTo(0, 6);
    expect(s.byCustomer[0].compare).toBeCloseTo(1000, 6);
  });
  it("expenses too", async () => {
    const { summariseExpenses, expensesAnalysis } = await import("@/lib/engine/expenses");
    const l = (period: string, amount: number) => ({ period, doc: `B/${period}`, series: "BILL", supplier: "S", account: "Rent", category: "Rent", cls: "exp_fixed", amount });
    const d = summariseExpenses([l("2026-09", 3000), l("2026-10", 1000)] as never);
    const accounts = [{ id: "a1", code: "6100", name: "Rent", cls: "exp_fixed", amounts: { "2026-09": 3000, "2026-10": 1000 } }];
    const e = expensesAnalysis(accounts as never, d, { type: "month", end: "2026-10" }, 1, { asOf: "2026-10-10" });
    expect(e.compare).toBeCloseTo(1000, 6);
  });
});

describe("Payments: days to collect over the days the books cover", () => {
  it("an ageing at 15 October with books to the 15th divides by 31 + 30 + 15 days, not a full October", async () => {
    const { paymentsAnalysis } = await import("@/lib/engine/payments");
    const B = ["At Date", "1-30", "31-60", "61-90", "91-120", "Older"];
    const d = { aged: { receivable: { asOf: "2026-10-15", buckets: B, findings: [], total: { amounts: [760, 0, 0, 0, 0, 0], total: 760 }, items: [{ partner: "A", ref: "INV/1", memo: "", day: null, amounts: [760, 0, 0, 0, 0, 0], total: 760 }] } }, payments: [] };
    // 10 a day: 310 in August, 300 in September, 150 to 15 October.
    const a = paymentsAnalysis(d as never, { type: "month", end: "2026-10" }, 1, { revenue: { "2026-08": 310, "2026-09": 300, "2026-10": 150 }, booksAsOf: "2026-10-15" });
    expect(a.receivable!.days).toBe(76);
  });
});

describe("Banking: the trend's latest year is the same twelve months as the assessment", () => {
  it("with the books stopping part-way through the last month", async () => {
    const { bankPack } = await import("@/lib/engine/bank-outlook");
    const ms: MonthData[] = [];
    for (let i = 0; i < 14; i++) { const y = 2025 + Math.floor((8 + i) / 12), mo = ((8 + i) % 12) + 1; ms.push(m(`${y}-${String(mo).padStart(2, "0")}`, i === 13 ? 1000 : 3000, 900)); }
    const p = bankPack(ms, "2026-10", { currency: "EGP", fyStartMonth: 1, taxRate: 22.5 }, {}, "Co", undefined, "en", "2026-10-10");
    const latest = p.trend.years[p.trend.years.length - 1];
    expect(latest.basis.P.revenue).toBeCloseTo(p.basis.P.revenue, 6);
  });
});

describe("burn uses months with their own balance sheet, over the real gap", () => {
  it("a carried-forward month adds no zero change, and a part month is left out", async () => {
    const { burnRate } = await import("@/lib/engine/insights");
    const pt = (period: string, cash: number, own = true) => ({ period, cash, debt: 0, own });
    // Cash falls 300 a month from June to September; August has no balance sheet of its own (carried forward);
    // October is a part month.
    const r = burnRate([pt("2026-06", 2000), pt("2026-07", 1700), pt("2026-08", 1700, false), pt("2026-09", 1100), pt("2026-10", 1000)], "2026-10-10");
    expect(r).toEqual({ burn: 300, months: 3 });
  });
  it("no fall in cash, no burn", async () => {
    const { burnRate } = await import("@/lib/engine/insights");
    expect(burnRate([{ period: "2026-08", cash: 100, debt: 0, own: true }, { period: "2026-09", cash: 200, debt: 0, own: true }], null)?.burn).toBeLessThanOrEqual(0);
  });
});

describe("targets for a part month", () => {
  it("a monthly revenue target is cut to the days covered", () => {
    const s = { ...settings, activeKpis: ["total_revenue"], targets: { total_revenue: 3100 } } as unknown as CompanySettings;
    const a = analyze(months, { type: "month", end: "2026-10" }, s, { asOf: "2026-10-10" });
    expect(a.targets.total_revenue).toBeCloseTo(1000, 6); // 3,100 × 10/31
  });
});

describe("review fixes", () => {
  it("the 3-month trend leaves out a part month (flat sales are not 'behind')", () => {
    const flat = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"].map((p) => m(p, 3000, 900));
    const a = analyze([...flat, m("2026-10", 1000, 900)], { type: "month", end: "2026-10" }, settings, { comparison: "prior", asOf: "2026-10-10" });
    expect(a.findings.some((f) => /Last 3 months/.test(f.title))).toBe(false);
  });
});

describe("account rows add up to their total row", () => {
  it("the comparison month's weight is the part month's share of its days", async () => {
    const { compareWeight } = await import("@/lib/engine/period");
    expect(compareWeight(10, "2026-09")).toBeCloseTo(10 / 30, 9);
    expect(compareWeight(30, "2026-02")).toBe(1); // never more than the month has
    expect(compareWeight(undefined, "2026-09")).toBe(1);
  });
});

describe("targets for a part month", () => {
  it("a month's chart target counts the days covered", async () => {
    const { monthTargets } = await import("@/lib/engine/analyze");
    const s = { ...settings, targets: { total_revenue: 3100 } } as unknown as CompanySettings;
    expect(monthTargets(s, "2026-10", "2026-10-10").total_revenue).toBeCloseTo(1000, 6);
    expect(monthTargets(s, "2026-09", "2026-10-10").total_revenue).toBe(3100);
  });
  it("a part month with no P&L is not taken off twice", () => {
    const bsOnly = { period: "2026-10", pl: {}, bs: { cash: 1000, ar: 900, retained_earnings: 1900 } } as MonthData;
    const s = { ...settings, targets: { total_revenue: 3100 } } as unknown as CompanySettings;
    const a = analyze([...months.slice(0, 4), bsOnly], { type: "month", end: "2026-10" }, s, { asOf: "2026-10-10" });
    expect(a.targets.total_revenue).toBeGreaterThanOrEqual(0);
  });
});

describe("an old stop day no longer applies", () => {
  it("only the latest month can be a part month", async () => {
    const { currentAsOf } = await import("@/lib/engine/period");
    expect(currentAsOf("2026-10-10", ["2026-09", "2026-10"])).toBe("2026-10-10");
    expect(currentAsOf("2026-08-10", ["2026-09", "2026-10"])).toBeNull();
    expect(currentAsOf(null, ["2026-10"])).toBeNull();
    expect(currentAsOf("2026-10-10", [])).toBeNull();
  });
});

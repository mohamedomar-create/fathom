import { describe, expect, it } from "vitest";
import { berkus, dealMaths, futureValue, growthMultiple, pitchValue, scorecard, strategicValue, BERKUS_CAP, SCORECARD_WEIGHTS } from "@/lib/engine/valuation/ask";

const r = (low: number, mid: number, high: number) => ({ low, mid, high });

describe("deal maths (ask EGP A for B%)", () => {
  it("values the company at A ÷ B", () => {
    expect(dealMaths({ amount: 2e6, pct: 0.1 })).toEqual({ value: 20e6, pct: 0.1, amount: 2e6, preMoney: 18e6 });
  });
  it("gives the share to offer for an amount at a value", () => {
    expect(dealMaths({ amount: 5e6, value: 25e6 })!.pct).toBeCloseTo(0.2, 10);
  });
  it("gives nothing for a zero or impossible share", () => {
    expect(dealMaths({ amount: 1e6, pct: 0 })).toBeNull();
    expect(dealMaths({ amount: 1e6, pct: 1.2 })).toBeNull();
  });
});

describe("growth-adjusted multiple", () => {
  it("is the sector range when growth is at the 10% norm or below", () => {
    expect(growthMultiple(r(4, 5, 6), 0.1)).toEqual(r(4, 5, 6));
    expect(growthMultiple(r(4, 5, 6), -0.05)).toEqual(r(4, 5, 6));
  });
  it("rises a quarter for every 10 points of growth above the norm", () => {
    const m = growthMultiple(r(4, 5, 6), 0.3);
    expect(m.mid).toBeCloseTo(7.5, 10); expect(m.high).toBeCloseTo(9, 10);
  });
  it("is capped at twice the range", () => {
    expect(growthMultiple(r(4, 5, 6), 2).mid).toBeCloseTo(10, 10);
  });
});

describe("investor pitch value", () => {
  it("multiplies profit and sales by growth-adjusted multiples, with no private discount", () => {
    const p = pitchValue({ revenue: 100e6, ebitda: 20e6, growth: 0.1, evEbitda: r(4, 5, 6), evSales: r(0.5, 1, 1.5), netDebt: 10e6 })!;
    // profit: 80M–120M EV, sales: 50M–150M EV; equity = EV − net debt.
    expect(p.low).toBeCloseTo(40e6, 0); expect(p.mid).toBeCloseTo(((100e6 + 100e6) / 2) - 10e6, 0); expect(p.high).toBeCloseTo(140e6, 0);
  });
  it("uses sales alone for a loss-making company", () => {
    const p = pitchValue({ revenue: 100e6, ebitda: -5e6, growth: 0.1, evEbitda: r(4, 5, 6), evSales: r(0.5, 1, 1.5), netDebt: 0 })!;
    expect(p.mid).toBeCloseTo(100e6, 0);
  });
  it("never goes below zero", () => {
    expect(pitchValue({ revenue: 10e6, ebitda: 1e6, growth: 0, evEbitda: r(4, 5, 6), evSales: r(0.5, 1, 1.5), netDebt: 1e9 })!.high).toBe(0);
  });
});

describe("strategic buyer value", () => {
  it("adds the share of synergies the buyer pays: savings and extra sales × profit multiple", () => {
    // costs 80M × 5% = 4M saved; 100M × 5% extra sales × 20% margin = 1M; 5M × 5× × 50% = 12.5M.
    const s = strategicValue({ fair: r(50e6, 60e6, 70e6), revenue: 100e6, ebitda: 20e6, multiple: 5, savings: 0.05, extraSales: 0.05, share: 0.5 });
    expect(s.synergy).toBeCloseTo(12.5e6, 0);
    expect(s.value).toEqual(r(62.5e6, 72.5e6, 82.5e6));
  });
});

describe("future value (VC method)", () => {
  it("is year-N profit × multiple brought back at the investor's target return", () => {
    const f = futureValue({ revenue: 100e6, ebitda: 20e6, growth: 0.2, years: 5, target: 0.35, evEbitda: r(4, 5, 6), evSales: r(0.5, 1, 1.5), netDebt: 0 })!;
    const profit5 = 20e6 * 1.2 ** 5;
    expect(f.exitProfit).toBeCloseTo(profit5, 0);
    expect(f.value.mid).toBeCloseTo((profit5 * 5) / 1.35 ** 5, 0);
    expect(f.value.low).toBeCloseTo((profit5 * 4) / 1.35 ** 5, 0);
  });
  it("uses sales when there is no profit", () => {
    const f = futureValue({ revenue: 100e6, ebitda: 0, growth: 0, years: 5, target: 0.35, evEbitda: r(4, 5, 6), evSales: r(0.5, 1, 1.5), netDebt: 0 })!;
    expect(f.value.mid).toBeCloseTo(100e6 / 1.35 ** 5, 0);
  });
});

describe("startup methods", () => {
  it("scorecard: an average company (2.5 everywhere) is worth the base value; better scores raise it", () => {
    const avg = { team: 2.5, market: 2.5, product: 2.5, competition: 2.5, channels: 2.5, traction: 2.5 };
    expect(scorecard(10e6, avg)).toBeCloseTo(10e6, 0);
    expect(scorecard(10e6, { ...avg, team: 5 })).toBeCloseTo(10e6 * (1 + SCORECARD_WEIGHTS.team), 0);
    expect(Object.values(SCORECARD_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });
  it("Berkus: each factor adds up to a fifth of the cap", () => {
    expect(berkus({ idea: 5, prototype: 5, team: 5, partners: 5, sales: 5 })).toBe(BERKUS_CAP);
    expect(berkus({ idea: 5, prototype: 0, team: 0, partners: 0, sales: 0 })).toBe(BERKUS_CAP / 5);
    expect(berkus({ idea: 9, prototype: 0, team: 0, partners: 0, sales: 0 })).toBe(BERKUS_CAP / 5);
  });
});

import { BENCHMARKS, valueCompany, type ValuationInputs } from "@/lib/engine/valuation";

const co: ValuationInputs = {
  currency: "EGP", label: "12 months to Sep 2026", end: "2026-09", covered: 12,
  revenue: 120e6, priorRevenue: 100e6, ebitda: 18e6, da: 2e6, netIncome: 9e6, interest: 3e6,
  capex: 3e6, owc: 24e6, taxRate: 0.225,
  cash: 10e6, investments: 0, debt: 20e6, lease: 0, endOfService: 2e6, provisions: 0, dividendsPayable: 0,
  equity: 40e6, liabilities: 60e6, ar: 30e6, inventory: 20e6, fixedAssets: 25e6, intangibles: 0, otherCA: 5e6,
  avgDebt: 20e6,
  quality: { months: 36, hasBalanceSheet: true, openChecks: 0, topCustomerShare: 0.15, revenueVolatility: 0.15, dso: 90 },
  inflation: null, partMonth: false,
};

describe("the ask band in a full valuation", () => {
  const v = valueCompany(co, { purpose: "owner", sector: "medical" });
  const plain = valueCompany(co, { purpose: "owner", sector: "medical", synergySavings: 0.2, vcReturn: 0.2 });
  it("never changes the fair value", () => {
    expect(plain.best).toEqual(v.best);
  });
  it("shows pitch, strategic and future values, and a band above the fair value", () => {
    const keys = v.ask.methods.filter((m) => m.value).map((m) => m.key);
    expect(keys).toEqual(expect.arrayContaining(["pitch", "strategic", "future"]));
    expect(v.ask.band!.high).toBeGreaterThan(v.best.high);
    const pitch = v.ask.methods.find((m) => m.key === "pitch")!.value!;
    const ev = (18e6 * BENCHMARKS.medical.evEbitda.mid * 1.25 + 120e6 * BENCHMARKS.medical.evSales.mid * 1.25) / 2; // 20% growth
    expect(pitch.mid).toBeCloseTo(ev - (20e6 + 2e6 - 10e6), 0);
  });
  it("gives the value before the private-company discount", () => {
    const zero = valueCompany(co, { purpose: "owner", sector: "medical", privateDiscount: 0 });
    expect(v.bestBeforeDiscount.mid).toBeCloseTo(zero.best.mid, 0);
    expect(v.bestBeforeDiscount.mid).toBeGreaterThan(v.best.mid);
  });
  it("startup methods appear only once the owner scores the company", () => {
    expect(v.ask.methods.find((m) => m.key === "scorecard")!.value).toBeNull();
    const s = valueCompany({ ...co, revenue: 8e6, priorRevenue: 4e6 }, { purpose: "owner", sector: "medical", scores: { team: 5, market: 4, product: 3, competition: 2.5, channels: 2.5, traction: 3 }, berkusScores: { idea: 4, prototype: 5, team: 4, partners: 3, sales: 5 } });
    expect(s.ask.methods.find((m) => m.key === "scorecard")!.value!.mid).toBeGreaterThan(0);
    expect(s.ask.methods.find((m) => m.key === "berkus")!.value!.mid).toBeGreaterThan(0);
  });
});

describe("review fixes: honest headline, real growth, new money, no balance sheet", () => {
  const v = valueCompany(co, { purpose: "owner", sector: "medical" });
  it("the highest you can ask for is the largest central figure, not the top of the widest range", () => {
    const mids = v.ask.methods.filter((m) => m.value).map((m) => m.value!.mid);
    expect(v.ask.band!.high).toBeCloseTo(Math.max(...mids), 0);
  });
  it("growth that only matches inflation earns no higher multiple", () => {
    const hot = valueCompany({ ...co, inflation: 30, priorRevenue: 120e6 / 1.3 }, { purpose: "owner", sector: "medical" });
    const pitch = hot.ask.methods.find((m) => m.key === "pitch")!.value!;
    const ev = (18e6 * BENCHMARKS.medical.evEbitda.mid + 120e6 * BENCHMARKS.medical.evSales.mid) / 2;
    expect(pitch.mid).toBeCloseTo(ev - 12e6, 0);
  });
  it("a loss-making company's future value is said in sales, not a negative profit", () => {
    const f = valueCompany({ ...co, ebitda: -5e6, netIncome: -8e6 }, { purpose: "owner", sector: "medical" }).ask.methods.find((m) => m.key === "future")!;
    expect(f.n!.basis).toBe(0);
    expect(f.n!.exitRevenue).toBeGreaterThan(0);
  });
  it("pitch and future values need a balance sheet, so debts are taken off", () => {
    const nb = valueCompany({ ...co, quality: { ...co.quality, hasBalanceSheet: false } }, { purpose: "owner", sector: "medical" });
    for (const k of ["pitch", "future"]) expect(nb.ask.methods.find((m) => m.key === k)!).toMatchObject({ value: null, reason: "noBalanceSheet" });
  });
  it("a bigger company's value starts from the value before the private-company discount", () => {
    const s = v.ask.methods.find((m) => m.key === "strategic")!;
    expect(s.value!.mid - s.n!.synergy).toBeCloseTo(v.bestBeforeDiscount.mid, 0);
    expect(s.n!.share).toBe(0.5);
  });
  it("debts larger than the value give no pitch figure, saying why", () => {
    const d = valueCompany({ ...co, debt: 2e9, avgDebt: 2e9 }, { purpose: "owner", sector: "medical" });
    expect(d.ask.methods.find((m) => m.key === "pitch")!).toMatchObject({ value: null, reason: "debt" });
  });
  it("startup methods are for young companies; empty scores are no scores", () => {
    const sc = { team: 5, market: 4, product: 3, competition: 2.5, channels: 2.5, traction: 3 };
    expect(valueCompany(co, { purpose: "owner", sector: "medical", scores: sc }).ask.methods.find((m) => m.key === "scorecard")!).toMatchObject({ value: null, reason: "notYoung" });
    const young = { ...co, revenue: 8e6, priorRevenue: 4e6 };
    expect(valueCompany(young, { purpose: "owner", sector: "medical", scores: {} }).ask.methods.find((m) => m.key === "scorecard")!.value).toBeNull();
    expect(valueCompany(young, { purpose: "owner", sector: "medical", scores: sc }).ask.methods.find((m) => m.key === "scorecard")!.value).not.toBeNull();
    expect(v.ask.netDebt).toBeCloseTo(12e6, 0);
  });
});

describe("deal maths with new money", () => {
  it("gives the value before the money comes in", () => {
    expect(dealMaths({ amount: 5e6, pct: 1 / 3 })!.preMoney).toBeCloseTo(10e6, 0);
  });
});

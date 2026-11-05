import { describe, expect, it } from "vitest";
import { BENCHMARKS, valueCompany, type ValuationInputs } from "@/lib/engine/valuation";

const base: ValuationInputs = {
  currency: "EGP", label: "12 months to Sep 2026", end: "2026-09", covered: 12,
  revenue: 120e6, priorRevenue: 100e6, ebitda: 18e6, da: 2e6, netIncome: 9e6, interest: 3e6,
  capex: 3e6, owc: 24e6, taxRate: 0.225,
  cash: 10e6, investments: 0, debt: 20e6, lease: 0, endOfService: 2e6, provisions: 0, dividendsPayable: 0,
  equity: 40e6, liabilities: 60e6, ar: 30e6, inventory: 20e6, fixedAssets: 25e6, intangibles: 0, otherCA: 5e6,
  avgDebt: 20e6,
  quality: { months: 36, hasBalanceSheet: true, openChecks: 0, topCustomerShare: 0.15, revenueVolatility: 0.15, dso: 90 },
  inflation: null, partMonth: false,
};

describe("valuing a company by every method", () => {
  const v = valueCompany(base, { purpose: "owner", sector: "medical" });
  it("gives a range for each method that applies, low ≤ mid ≤ high", () => {
    for (const m of v.methods.filter((x) => x.value)) {
      expect(m.value!.low).toBeLessThanOrEqual(m.value!.mid);
      expect(m.value!.mid).toBeLessThanOrEqual(m.value!.high);
    }
    expect(v.methods.find((m) => m.key === "dcf")!.value).not.toBeNull();
    expect(v.methods.find((m) => m.key === "ebitda")!.value).not.toBeNull();
  });
  it("the EBITDA method: EV = EBITDA × multiple, the bridge to equity, then the private-company discount on the equity", () => {
    const m = v.methods.find((x) => x.key === "ebitda")!;
    const evMid = 18e6 * BENCHMARKS.medical.evEbitda.mid;
    expect(m.ev!.mid).toBeCloseTo(evMid, 0);
    expect(m.value!.mid).toBeCloseTo((evMid - 20e6 - 2e6 + 10e6) * (1 - v.assumptions.privateDiscount), 0);
  });
  it("the same private-company discount applies to every earnings method, not to the asset methods", () => {
    const zero = valueCompany(base, { purpose: "owner", sector: "medical", privateDiscount: 0 });
    for (const k of ["dcf", "ebitda", "pe", "capitalised"] as const) {
      const a = v.methods.find((x) => x.key === k)!.value!.mid, b = zero.methods.find((x) => x.key === k)!.value!.mid;
      expect(a / b).toBeCloseTo(1 - v.assumptions.privateDiscount, 6);
    }
    expect(zero.methods.find((x) => x.key === "adjustedAssets")!.value).toEqual(v.methods.find((x) => x.key === "adjustedAssets")!.value);
  });
  it("shareholders can't lose more than they put in: a method's value never goes below zero, and the page says why", () => {
    const d = valueCompany({ ...base, debt: 400e6, avgDebt: 400e6, interest: 60e6 }, { purpose: "bank", sector: "medical" });
    for (const m of d.methods.filter((x) => x.value)) expect(m.value!.low).toBeGreaterThanOrEqual(0);
    expect(d.best.low).toBeGreaterThanOrEqual(0);
    expect(d.limits.map((x) => x.key)).toContain("debtAboveValue");
  });
  it("liquidation is a floor shown beside the estimate, never blended into it", () => {
    for (const p of ["owner", "sale", "bank", "partners"] as const) expect(valueCompany(base, { purpose: p, sector: "medical" }).best.weights.liquidation ?? 0).toBe(0);
  });
  it("the cash-flow method is consistent with the market: its implied exit multiple is not far below the discounted market range", () => {
    const x = v.dcf!.impliedExitMultiple;
    expect(x).toBeGreaterThan(BENCHMARKS.medical.evEbitda.low * 0.6);
  });
  it("lower-quality books widen every range around the same central figure", () => {
    const poor = valueCompany({ ...base, quality: { ...base.quality, months: 10, openChecks: 3 } }, { purpose: "owner", sector: "medical" });
    const a = v.methods.find((x) => x.key === "ebitda")!.value!, b = poor.methods.find((x) => x.key === "ebitda")!.value!;
    expect(b.mid).toBeCloseTo(a.mid, 0);
    expect(b.high - b.low).toBeGreaterThan(a.high - a.low);
  });
  it("without a balance sheet the enterprise-value methods don't pretend to be equity", () => {
    const n = valueCompany({ ...base, quality: { ...base.quality, hasBalanceSheet: false } }, { purpose: "owner", sector: "medical" });
    for (const k of ["dcf", "ebitda", "sales", "sde"] as const) expect(n.methods.find((m) => m.key === k)!.value).toBeNull();
    expect(n.methods.find((m) => m.key === "pe")!.value).not.toBeNull();
  });
  it("the owner-run method needs the owner's pay", () => {
    const small = { ...base, revenue: 30e6, priorRevenue: 25e6, ebitda: 4e6, netIncome: 2e6 };
    expect(valueCompany(small, { purpose: "sale", sector: "trading" }).methods.find((m) => m.key === "sde")!.value).toBeNull();
    expect(valueCompany(small, { purpose: "sale", sector: "trading", ownerPay: 1e6 }).methods.find((m) => m.key === "sde")!.value).not.toBeNull();
  });
  it("leases already inside loans are not taken off twice", () => {
    const inLoans = valueCompany({ ...base, lease: 5e6, leaseInDebt: 5e6 }, { purpose: "owner", sector: "medical" });
    expect(inLoans.methods.find((m) => m.key === "ebitda")!.value!.mid).toBeCloseTo(v.methods.find((m) => m.key === "ebitda")!.value!.mid, 0);
  });
  it("the best estimate lies inside the methods' spread", () => {
    const mids = v.methods.filter((x) => x.value && (v.best.weights[x.key] ?? 0) > 0).map((x) => x.value!.mid);
    expect(v.best.mid).toBeGreaterThanOrEqual(Math.min(...mids));
    expect(v.best.mid).toBeLessThanOrEqual(Math.max(...mids));
  });
  it("uses the company's own cost of debt and the build-up cost of equity", () => {
    expect(v.capital.costOfDebt).toBeCloseTo(0.15, 6);
    expect(v.capital.costOfEquity).toBeCloseTo(v.capital.riskFree + 0.06 + 0.04 + v.capital.specificPremium, 6);
  });
  it("a loss-making company has no earnings multiples, and says why", () => {
    const l = valueCompany({ ...base, ebitda: -2e6, netIncome: -5e6 }, { purpose: "owner", sector: "medical" });
    expect(l.methods.find((m) => m.key === "ebitda")!.value).toBeNull();
    expect(l.methods.find((m) => m.key === "pe")!.value).toBeNull();
    expect(l.limits.map((x) => x.key)).toContain("loss");
  });
  it("names its limitations: short history, concentration, open checks", () => {
    const s = valueCompany({ ...base, quality: { ...base.quality, months: 10, openChecks: 2, topCustomerShare: 0.45 } }, { purpose: "sale", sector: "trading" });
    expect(s.limits.map((x) => x.key)).toEqual(expect.arrayContaining(["shortHistory", "openChecks", "concentration", "multiples"]));
  });
  it("a bank purpose leans more on assets than the owner's", () => {
    const b = valueCompany(base, { purpose: "bank", sector: "medical" });
    expect(b.best.weights.adjustedAssets ?? 0).toBeGreaterThan(v.best.weights.adjustedAssets ?? 0);
  });
  it("shows USD at the rate given", () => {
    const u = valueCompany(base, { purpose: "owner", sector: "medical", fx: 50 });
    expect(u.usd!.mid).toBeCloseTo(u.best.mid / 50, 6);
  });
  it("owner adjustments move EBITDA-based values", () => {
    const a = valueCompany(base, { purpose: "owner", sector: "medical", adjustments: [{ key: "oneoff", label: "lawsuit", amount: 2e6 }] });
    expect(a.methods.find((m) => m.key === "ebitda")!.ev!.mid).toBeCloseTo(20e6 * BENCHMARKS.medical.evEbitda.mid, 0);
  });
});

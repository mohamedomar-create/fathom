import { describe, expect, it } from "vitest";
import { valueCompany, type ValuationInputs } from "@/lib/engine/valuation";

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
  it("the EBITDA method is the multiple less the private discount, then the bridge to equity", () => {
    const m = v.methods.find((x) => x.key === "ebitda")!;
    const evMid = 18e6 * 9.5 * 0.75;
    expect(m.ev!.mid).toBeCloseTo(evMid, 0);
    expect(m.value!.mid).toBeCloseTo(evMid - 20e6 - 2e6 + 10e6, 0);
  });
  it("the best estimate lies inside the methods' spread", () => {
    const mids = v.methods.filter((x) => x.value && (v.best.weights[x.key] ?? 0) > 0).map((x) => x.value!.mid);
    expect(v.best.mid).toBeGreaterThanOrEqual(Math.min(...mids));
    expect(v.best.mid).toBeLessThanOrEqual(Math.max(...mids));
  });
  it("uses the company's own cost of debt and the build-up cost of equity", () => {
    expect(v.capital.costOfDebt).toBeCloseTo(0.15, 6);
    expect(v.capital.costOfEquity).toBeCloseTo(0.21 + 0.06 + 0.04 + v.capital.specificPremium, 6);
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
  it("a bank purpose leans on assets; owner purpose on earnings", () => {
    const b = valueCompany(base, { purpose: "bank", sector: "medical" });
    expect(b.best.weights.liquidation ?? 0).toBeGreaterThan(0);
    expect(v.best.weights.liquidation ?? 0).toBe(0);
  });
  it("shows USD at the rate given", () => {
    const u = valueCompany(base, { purpose: "owner", sector: "medical", fx: 50 });
    expect(u.usd!.mid).toBeCloseTo(u.best.mid / 50, 6);
  });
  it("owner adjustments move EBITDA-based values", () => {
    const a = valueCompany(base, { purpose: "owner", sector: "medical", adjustments: [{ key: "oneoff", label: "lawsuit", amount: 2e6 }] });
    expect(a.methods.find((m) => m.key === "ebitda")!.ev!.mid).toBeCloseTo(20e6 * 9.5 * 0.75, 0);
  });
});

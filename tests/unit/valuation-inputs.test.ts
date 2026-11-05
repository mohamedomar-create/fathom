import { describe, expect, it } from "vitest";
import { demoCompany } from "@/lib/company/demo";
import { valuationInputs } from "@/lib/valuation/inputs";
import { valueCompany } from "@/lib/engine/valuation";

describe("valuation inputs from a company's books", () => {
  it("reads the demo company and values it", () => {
    const c = demoCompany();
    const i = valuationInputs(c, null)!;
    expect(i.revenue).toBeGreaterThan(0);
    expect(i.quality.months).toBeGreaterThanOrEqual(12);
    expect(i.debt).toBeGreaterThanOrEqual(0);
    const v = valueCompany(i, { purpose: "owner", sector: "medical" });
    expect(v.best.mid).toBeGreaterThan(0);
    expect(v.methods.filter((m) => m.value).length).toBeGreaterThanOrEqual(5);
  });
  it("finds the largest customer's share over the twelve months", () => {
    const c = demoCompany();
    const i = valuationInputs(c, { customers: [{ p: "2099-01", c: "x", s: "", sp: "", a: 1, k: null, ka: null, q: null, d: 1, n: 1 }], products: [], sources: {} })!;
    expect(i.quality.topCustomerShare).toBeNull();
  });
});

describe("debt-like items from sub-classes", () => {
  const month = (period: string, extra: Partial<import("@/lib/engine/types").MonthData> = {}) => ({
    period, pl: { revenue: 100, cos_variable: 40, exp_fixed: 30 }, bs: { cash: 50, ar: 114, ltd: 300, other_ncl: 0, retained_earnings: -136 }, ...extra,
  });
  const months = Array.from({ length: 12 }, (_, i) => month(`2026-${String(i + 1).padStart(2, "0")}`));
  it("a lease booked inside loans is marked as already in the debt", () => {
    months[11] = month("2026-12", { sub: { lease_liability: 80 }, subOf: { ltd: 80 } });
    const i = valuationInputs({ months, settings: { currency: "EGP", fyStartMonth: 1, taxRate: 0.225, vatRate: 0.14 }, asOf: undefined, health: undefined, assumptions: undefined }, null)!;
    expect(i.lease).toBe(80);
    expect(i.leaseInDebt).toBe(80);
  });
  it("receivables are taken net of VAT for debtor days", () => {
    const i = valuationInputs({ months, settings: { currency: "EGP", fyStartMonth: 1, taxRate: 0.225, vatRate: 0.14 }, asOf: undefined, health: undefined, assumptions: undefined }, null)!;
    expect(i.quality.dso).toBeCloseTo(100 / (1200 / 365), 6);
  });
});

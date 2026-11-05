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

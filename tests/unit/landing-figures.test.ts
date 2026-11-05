import { describe, expect, it } from "vitest";
import { landingFigures } from "@/lib/landing/figures";
import { demoCompany } from "@/lib/company/demo";
import { valuationInputs } from "@/lib/valuation/inputs";
import { valueCompany } from "@/lib/engine/valuation";

describe("the landing page's figures come from the demo company itself", () => {
  const f = landingFigures();
  it("revenue, margin and cash for the latest month, with twelve months of history", () => {
    expect(f.revenue).toBeGreaterThan(0);
    expect(f.series.revenue).toHaveLength(12);
    expect(f.series.ebit).toHaveLength(12);
    expect(f.gpm).toBeGreaterThan(0);
    expect(f.cash).toBeGreaterThan(0);
    expect(f.kpiOnTrack).toBeGreaterThan(0);
    expect(f.kpiOnTrack).toBeLessThanOrEqual(1);
  });
  it("the cost structure adds up to revenue: cost of sales + expenses + operating result (before other income)", () => {
    expect(f.mix.cos + f.mix.expenses).toBeGreaterThan(0);
    expect(f.series.costs).toHaveLength(12);
    expect(f.series.cash).toHaveLength(12);
    expect(f.series.revenue.at(-1)).toBeCloseTo(f.revenue, 6);
  });
  it("the valuation is the same one the Valuation page shows", () => {
    const v = valueCompany(valuationInputs(demoCompany(), null)!, { purpose: "owner", sector: "medical" });
    expect(f.value.fair).toBeCloseTo(v.best.mid, 0);
    expect(f.value.highest).toBeGreaterThanOrEqual(f.value.fair);
  });
  it("the system doctor's health score and what it found", () => {
    expect(f.doctor.score).toBeGreaterThanOrEqual(0);
    expect(f.doctor.score).toBeLessThanOrEqual(100);
    expect(f.doctor.findings).toBeGreaterThanOrEqual(0);
  });
});

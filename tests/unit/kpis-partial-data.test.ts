// Reference §13.4: revenue without cost data shows revenue, never a fabricated margin.
import { describe, expect, it } from "vitest";
import { bsCalc, plCalc } from "@/lib/engine/statements";
import { computeKpis } from "@/lib/engine/kpis";

const B = bsCalc({ cash: 100, ar: 50, retained_earnings: 150 });
const run = (pl: Parameters<typeof plCalc>[0]) => computeKpis({ P: plCalc(pl), B, B0: null, Pprev: null, days: 30, ocf: null });

describe("KPIs never invent a margin from missing data", () => {
  it("revenue only: revenue shows, every margin is not available", () => {
    const k = run({ revenue: 1000 });
    expect(k.total_revenue).toBe(1000);
    for (const key of ["gpm", "opm", "profit_ratio", "npat", "ebitda_margin", "gmroi", "exp_ratio", "mos", "nvcf"]) expect(k[key], key).toBeNull();
  });
  it("revenue and cost of sales but no expenses: gross margin shows, operating margins don't", () => {
    const k = run({ revenue: 1000, cos_variable: 600 });
    expect(k.gpm).toBeCloseTo(40, 6);
    for (const key of ["opm", "profit_ratio", "npat", "ebitda_margin", "exp_ratio"]) expect(k[key], key).toBeNull();
  });
  it("a service business with expenses but no cost of sales: operating margins show, gross margin doesn't", () => {
    const k = run({ revenue: 1000, exp_fixed: 700 });
    expect(k.gpm).toBeNull();
    expect(k.opm).toBeCloseTo(30, 6);
    expect(k.ebitda_margin).toBeCloseTo(30, 6);
  });
  it("full books give every margin as before", () => {
    const k = run({ revenue: 1000, cos_variable: 500, exp_fixed: 300, exp_depreciation: 20 });
    expect(k.gpm).toBeCloseTo(50, 6);
    expect(k.opm).toBeCloseTo(18, 6);
    expect(k.ebitda_margin).toBeCloseTo(20, 6);
  });
});

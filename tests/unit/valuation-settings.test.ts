import { describe, expect, it } from "vitest";
import { ValuationSettingsSchema, valuationSettingsOf } from "@/lib/valuation/settings";

describe("saved valuation settings", () => {
  it("reads them from the profile, with defaults when absent", () => {
    expect(valuationSettingsOf(null)).toEqual({ purpose: "owner", sector: "other" });
    expect(valuationSettingsOf({ profile: { valuation: { purpose: "bank", sector: "medical", riskFree: 0.2 } } })).toMatchObject({ purpose: "bank", sector: "medical", riskFree: 0.2 });
  });
  it("drops only the figure that is not valid, keeping the other saved choices", () => {
    expect(valuationSettingsOf({ profile: { valuation: { purpose: "x", sector: "medical", riskFree: 9, beta: 1.2 } } })).toEqual({ purpose: "owner", sector: "medical", beta: 1.2 });
  });
  it("refuses out-of-range figures when saving", () => {
    expect(ValuationSettingsSchema.safeParse({ purpose: "owner", sector: "other", longGrowth: 0.5 }).success).toBe(false);
    expect(ValuationSettingsSchema.safeParse({ purpose: "owner", sector: "other", adjustments: [{ key: "oneoff", label: "x", amount: 5 }] }).success).toBe(true);
    expect(ValuationSettingsSchema.safeParse({ purpose: "owner", sector: "other", adjustments: Array.from({ length: 41 }, () => ({ key: "oneoff", label: "x", amount: 1 })) }).success).toBe(false);
  });
});

describe("the owner's scores and deal inputs", () => {
  it("are saved when in range and refused when not", async () => {
    const { ValuationSettingsSchema } = await import("@/lib/valuation/settings");
    const ok = { purpose: "owner", sector: "other", synergySavings: 0.1, vcReturn: 0.4, vcYears: 5, scores: { team: 5, market: 4, product: 3, competition: 2, channels: 1, traction: 0 }, berkusScores: { idea: 1, prototype: 2, team: 3, partners: 4, sales: 5 } };
    expect(ValuationSettingsSchema.safeParse(ok).success).toBe(true);
    expect(ValuationSettingsSchema.safeParse({ ...ok, scores: { ...ok.scores, team: 9 } }).success).toBe(false);
    expect(ValuationSettingsSchema.safeParse({ ...ok, vcYears: 30 }).success).toBe(false);
  });
});

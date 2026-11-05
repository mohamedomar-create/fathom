import { describe, expect, it } from "vitest";
import { ValuationSettingsSchema, valuationSettingsOf } from "@/lib/valuation/settings";

describe("saved valuation settings", () => {
  it("reads them from the profile, with defaults when absent", () => {
    expect(valuationSettingsOf(null)).toEqual({ purpose: "owner", sector: "other" });
    expect(valuationSettingsOf({ profile: { valuation: { purpose: "bank", sector: "medical", riskFree: 0.2 } } })).toMatchObject({ purpose: "bank", sector: "medical", riskFree: 0.2 });
  });
  it("drops anything not valid instead of trusting it", () => {
    expect(valuationSettingsOf({ profile: { valuation: { purpose: "x", sector: "medical", riskFree: 9 } } })).toEqual({ purpose: "owner", sector: "other" });
  });
  it("refuses out-of-range figures when saving", () => {
    expect(ValuationSettingsSchema.safeParse({ purpose: "owner", sector: "other", longGrowth: 0.5 }).success).toBe(false);
    expect(ValuationSettingsSchema.safeParse({ purpose: "owner", sector: "other", adjustments: [{ key: "oneoff", label: "x", amount: 5 }] }).success).toBe(true);
    expect(ValuationSettingsSchema.safeParse({ purpose: "owner", sector: "other", adjustments: Array.from({ length: 41 }, () => ({ key: "oneoff", label: "x", amount: 1 })) }).success).toBe(false);
  });
});

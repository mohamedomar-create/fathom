import { describe, expect, it } from "vitest";
import { PlanSchema, invalidImport } from "@/lib/company/import-schema";

const plan = (over: Record<string, unknown> = {}) => ({
  companyId: "00000000-0000-4000-8000-000000000001", mode: "merge",
  slices: { PL: ["2026-10"], BS: ["2026-10"] },
  accounts: [{ code: "400100", name: "Sales", cls: "revenue", amounts: { "2026-10": 100 } }],
  ...over,
});

describe("what an upload may send to be saved", () => {
  it("a Trial Balance or P&L column covering 2015 to October 2026 (142 months) is accepted", () => {
    const v = PlanSchema.safeParse(plan({ ranges: { "2026-10": 142 }, controls: [{ metric: "net_income", period: "2026-10", value: 1, source: "P&L row 40", months: 142 }] }));
    expect(v.success).toBe(true);
  });

  it("an impossible span is still refused, with a message that says what and why", () => {
    const input = plan({ ranges: { "2026-10": 601 } });
    const v = PlanSchema.safeParse(input);
    expect(v.success).toBe(false);
    if (!v.success) expect(invalidImport(v.error, input)).toBe("The import data is not valid: a P&L column for Oct 2026 covers 601 months; at most 600 can be read.");
  });
});

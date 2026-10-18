// Which days the last import covered, for counting back-dated postings (review of 1.4).
import { describe, expect, it } from "vitest";
import { sinceOf } from "@/lib/odoo/since";

describe("the days the last import covered", () => {
  it("an Odoo sync covered up to the day it ran, not the end of its month: an invoice dated after it is not back-dated", () => {
    expect(sinceOf("2026-10-10T09:00:00Z", { kind: "odoo", periods: ["2026-09", "2026-10"] })).toEqual({ at: "2026-10-10T09:00:00Z", through: "2026-10-10" });
  });
  it("an upload covered its cut-off, else its part-month day, else the end of its last month", () => {
    expect(sinceOf("2026-10-18T09:00:00Z", { kind: "gl", periods: ["2026-10"], cutoff: "2026-10-15", asOf: "2026-10-16" })!.through).toBe("2026-10-15");
    expect(sinceOf("2026-10-18T09:00:00Z", { kind: "gl", periods: ["2026-10"], asOf: "2026-10-16" })!.through).toBe("2026-10-16");
    expect(sinceOf("2026-10-18T09:00:00Z", { kind: "gl", periods: ["2026-08", "2026-09"] })!.through).toBe("2026-09-30");
    expect(sinceOf("2026-10-18T09:00:00Z", {})).toBeUndefined();
  });
});

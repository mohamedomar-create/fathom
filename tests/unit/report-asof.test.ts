import { describe, expect, it } from "vitest";
import { reportAsOf } from "@/lib/engine";

describe("the part-month day stored with an upload", () => {
  it("uses the reader's own part-month day when there is one", () => {
    expect(reportAsOf({ asOf: "2026-10-15", cutoff: "2026-10-07" })).toBe("2026-10-15");
  });
  it("falls back to the cut-off the wizard showed, so a ledger ending 7 Oct is a part month", () => {
    expect(reportAsOf({ cutoff: "2026-10-07" })).toBe("2026-10-07");
  });
  it("a cut-off on the month's last day is a full month, not a part month", () => {
    expect(reportAsOf({ cutoff: "2026-09-30" })).toBeNull();
  });
  it("nothing stored, nothing assumed", () => {
    expect(reportAsOf({})).toBeNull();
    expect(reportAsOf(null)).toBeNull();
    expect(reportAsOf({ cutoff: "junk" })).toBeNull();
  });
});

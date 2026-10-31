// O21: creating a report checks the role on the server and says why it was refused, instead of throwing.
import { describe, expect, it } from "vitest";
import { REPORT_REFUSAL, reportRefusal } from "@/lib/report/create-guard";

describe("creating a report", () => {
  it("a viewer is refused with a reason; bad input is refused; an editor with a month may create", () => {
    expect(reportRefusal("viewer", "c3b8f0b2-0000-4000-8000-000000000000", "2026-09")).toBe("view-only");
    expect(reportRefusal("editor", "not-a-uuid", "2026-09")).toBe("invalid");
    expect(reportRefusal("editor", "c3b8f0b2-0000-4000-8000-000000000000", "2026-13")).toBe("invalid");
    expect(reportRefusal("admin", "c3b8f0b2-0000-4000-8000-000000000000", "2026-09")).toBeNull();
    expect(REPORT_REFUSAL["view-only"]).toMatch(/View-only/);
  });
  it("every refusal has a message for the page", () => {
    for (const k of ["view-only", "invalid", "save"] as const) expect(REPORT_REFUSAL[k].length).toBeGreaterThan(10);
  });
});

// O12: the stock summary state as the pages read it. A failed rebuild with a last good copy shows that copy as stale
// (with its time); with no copy, it is a failed build; an old-style error summary is a failed build too.
import { describe, expect, it } from "vitest";
import { inventoryStateFrom } from "@/lib/company/inventory-wire";

describe("inventoryStateFrom", () => {
  it("a good summary: shown, nothing failed", () => {
    expect(inventoryStateFrom({ summary: { v: 1 }, built_at: "2026-10-30T10:00:00Z", pending: false })).toEqual({ wire: { v: 1 }, pending: false, error: null, builtAt: "2026-10-30T10:00:00Z", failedAt: null });
  });
  it("a failed rebuild keeps the last good copy, marked with when the rebuild failed", () => {
    expect(inventoryStateFrom({ summary: { v: 1 }, built_at: "2026-10-30T10:00:00Z", pending: false, error: "boom", error_at: "2026-10-31T09:00:00Z" }))
      .toEqual({ wire: { v: 1 }, pending: false, error: null, builtAt: "2026-10-30T10:00:00Z", failedAt: "2026-10-31T09:00:00Z" });
  });
  it("a failed first build, and an old error summary, are failed builds", () => {
    expect(inventoryStateFrom({ summary: null, pending: false, error: "first", error_at: "2026-10-31T09:00:00Z" })).toMatchObject({ wire: null, error: "BUILD_FAILED" });
    expect(inventoryStateFrom({ summary: { error: "old" }, pending: false })).toMatchObject({ wire: null, error: "BUILD_FAILED" });
  });
});

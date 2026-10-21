import { describe, expect, it } from "vitest";
import { accountsCounted } from "@/components/preflight/summary";

describe("accountsCounted", () => {
  it("counts each account once and each month once, P&L and balance sheet together", () => {
    const res = { lines: [{ key: "4000" }, { key: "4000" }, { key: "1000" }, { key: "2000" }], slices: { PL: ["2026-08", "2026-09"], BS: ["2026-09", "2026-10"] } };
    expect(accountsCounted(res)).toBe("3 accounts × 3 months");
  });
});

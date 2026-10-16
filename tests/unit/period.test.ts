import { describe, expect, it } from "vitest";

describe("a module's own months", () => {
  it("lists every month and year of a stock history that starts before the accounts", async () => {
    const { selectableEndsOf } = await import("@/lib/engine/period");
    const ps = ["2021-07", "2021-12", "2024-03", "2026-10"];
    expect(selectableEndsOf(ps, "month", 1).map((e) => e.end)).toEqual(ps);
    expect(selectableEndsOf(ps, "year", 1).map((e) => e.end)).toEqual(["2021-12", "2024-03", "2026-10"]);
    expect(selectableEndsOf([], "year", 1)).toEqual([]);
  });
});

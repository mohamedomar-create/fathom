import { describe, expect, it } from "vitest";
import { localLimiter } from "@/lib/local-limit";

describe("an in-process limit for signed-out addresses", () => {
  it("allows the maximum in the window, refuses the next, and frees up when the window passes", () => {
    const over = localLimiter(600_000, 5);
    const t = 1_000_000;
    expect([1, 2, 3, 4, 5].map((i) => over("10.0.0.1", t + i))).toEqual([false, false, false, false, false]);
    expect(over("10.0.0.1", t + 6)).toBe(true);
    expect(over("10.0.0.2", t + 7)).toBe(false);
    expect(over("10.0.0.1", t + 600_002)).toBe(false);
  });
  it("forgets old addresses so the memory stays bounded", () => {
    const over = localLimiter(1_000, 1, 3);
    over("a", 0); over("b", 1); over("c", 2); over("d", 3);
    expect(over.size()).toBeLessThanOrEqual(3);
  });
});

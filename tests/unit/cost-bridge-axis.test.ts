import { describe, it, expect } from "vitest";
import { bridgeAxis } from "@/lib/engine";

describe("cost bridge axis", () => {
  it("starts at 0, so bar lengths stay true to the amounts", () => {
    expect(bridgeAxis([900_000, 950_000, 1_000_000])).toEqual({ lo: 0, hi: 1_000_000 });
  });
  it("reaches below 0 when a running total does", () => {
    expect(bridgeAxis([100, -40, 60])).toEqual({ lo: -40, hi: 100 });
  });
});

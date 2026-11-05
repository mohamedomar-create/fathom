import { describe, expect, it } from "vitest";
import { plainNumber } from "@/lib/valuation/number";

describe("typing numbers on the valuation page", () => {
  it("reads Arabic-Indic digits, the Arabic decimal point, thousands commas and a typed minus", () => {
    expect(plainNumber("١٢٫٥")).toBe("12.5");
    expect(plainNumber("1,250,000")).toBe("1250000");
    expect(plainNumber("−3.5")).toBe("-3.5");
    expect(plainNumber("۲۰")).toBe("20");
  });
});

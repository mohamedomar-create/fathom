import { describe, expect, it } from "vitest";
import { compact, money } from "@/lib/engine/format";

describe("compact amounts (the budget page)", () => {
  it("millions and thousands, English", () => {
    expect(compact(2_800_000)).toBe("2.8M");
    expect(compact(450_000)).toBe("450K");
    expect(compact(12_500)).toBe("12.5K");
    expect(compact(950)).toBe("950");
    expect(compact(0)).toBe("0");
  });
  it("Arabic reads م for million and ألف for thousand", () => {
    expect(compact(2_800_000, "ar")).toBe("2.8 م");
    expect(compact(450_000, "ar")).toBe("450 ألف");
    expect(compact(12_500, "ar")).toBe("12.5 ألف");
    expect(compact(950, "ar")).toBe("950");
  });
  it("negatives carry a minus sign", () => {
    expect(compact(-2_800_000)).toBe("-2.8M");
    expect(compact(-12_500, "ar")).toBe("-12.5 ألف");
    expect(compact(-950)).toBe("-950");
    expect(compact(-0.2)).toBe("0");
  });
  it("rounds across the boundaries without 1000K or 100.0K", () => {
    expect(compact(999_600)).toBe("1.0M");
    expect(compact(99_960)).toBe("100K");
    expect(compact(999.6)).toBe("1.0K");
    expect(compact(150_400)).toBe("150K");
    expect(compact(2_400_000_000)).toBe("2.4B");
    expect(compact(2_400_000_000, "ar")).toBe("2.4 مليار");
  });
  it("leaves money() as it was for the other pages", () => {
    expect(money(2_800_000, "SAR", true)).toBe("SAR 2.8M");
    expect(money(450_000, "SAR", true)).toBe("SAR 450K");
    expect(money(2_800_000, "SAR")).toBe("SAR 2,800,000");
  });
});

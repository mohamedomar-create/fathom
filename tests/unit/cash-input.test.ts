import { describe, expect, it } from "vitest";
import { typedAmount } from "@/lib/cash/input";

describe("an amount typed by hand", () => {
  it("Arabic digits, thousands and decimal commas read the way they were meant", () => {
    expect(typedAmount("١٢٠٠")).toBe(1200);
    expect(typedAmount("1,200")).toBe(1200);
    expect(typedAmount("1.234,50")).toBe(1234.5);
    expect(typedAmount("12,5")).toBe(12.5);
    expect(typedAmount(" 250 ")).toBe(250);
  });
  it("nothing typed, or no number in it, is not an amount", () => {
    expect(typedAmount("")).toBeNull();
    expect(typedAmount("abc")).toBeNull();
  });
});

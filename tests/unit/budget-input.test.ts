import { describe, expect, it } from "vitest";
import { parseBudgetInput } from "@/lib/engine/budget-builder";

describe("parse-input", () => {
  it("reads plain amounts, with or without thousands commas", () => {
    expect(parseBudgetInput("120000")).toEqual({ kind: "amount", value: 120000 });
    expect(parseBudgetInput("120,000")).toEqual({ kind: "amount", value: 120000 });
    expect(parseBudgetInput(" 1,234.5 ")).toEqual({ kind: "amount", value: 1234.5 });
    expect(parseBudgetInput("-500")).toEqual({ kind: "amount", value: -500 });
  });
  it("reads Arabic-Indic digits (and the Arabic thousands and decimal marks)", () => {
    expect(parseBudgetInput("١٢٠٠٠٠")).toEqual({ kind: "amount", value: 120000 });
    expect(parseBudgetInput("١٢٠٬٠٠٠")).toEqual({ kind: "amount", value: 120000 });
    expect(parseBudgetInput("١٫٥")).toEqual({ kind: "amount", value: 1.5 });
  });
  it("reads a percentage change", () => {
    expect(parseBudgetInput("+10%")).toEqual({ kind: "pct", value: 10 });
    expect(parseBudgetInput("-5 %")).toEqual({ kind: "pct", value: -5 });
    expect(parseBudgetInput("10%")).toEqual({ kind: "pct", value: 10 });
    expect(parseBudgetInput("+١٠٪")).toEqual({ kind: "pct", value: 10 });
  });
  it("empty or invalid text means no change", () => {
    expect(parseBudgetInput("")).toBeNull();
    expect(parseBudgetInput("   ")).toBeNull();
    expect(parseBudgetInput("abc")).toBeNull();
    expect(parseBudgetInput("12a")).toBeNull();
    expect(parseBudgetInput("%")).toBeNull();
    expect(parseBudgetInput("1.2.3")).toBeNull();
    expect(parseBudgetInput("1e400")).toBeNull();
  });
  it("reads the compact forms the page shows (2.8M, 450K, 2.8 م, 450 ألف)", () => {
    expect(parseBudgetInput("2.8M")).toEqual({ kind: "amount", value: 2_800_000 });
    expect(parseBudgetInput("2.8m")).toEqual({ kind: "amount", value: 2_800_000 });
    expect(parseBudgetInput("450K")).toEqual({ kind: "amount", value: 450_000 });
    expect(parseBudgetInput("12.5k")).toEqual({ kind: "amount", value: 12_500 });
    expect(parseBudgetInput("1.2B")).toEqual({ kind: "amount", value: 1_200_000_000 });
    expect(parseBudgetInput("2.8 م")).toEqual({ kind: "amount", value: 2_800_000 });
    expect(parseBudgetInput("450 ألف")).toEqual({ kind: "amount", value: 450_000 });
    expect(parseBudgetInput("1.2 مليار")).toEqual({ kind: "amount", value: 1_200_000_000 });
    expect(parseBudgetInput("١٫٥ م")).toEqual({ kind: "amount", value: 1_500_000 });
    expect(parseBudgetInput("-450K")).toEqual({ kind: "amount", value: -450_000 });
    expect(parseBudgetInput("1.0M")).toEqual({ kind: "amount", value: 1_000_000 });
    expect(parseBudgetInput("10%K")).toBeNull();
    expect(parseBudgetInput("K")).toBeNull();
  });
});

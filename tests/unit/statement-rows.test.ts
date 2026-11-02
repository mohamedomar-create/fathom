// Highlighted statements: which lines are shaded, which way is better, which lines are flagged, and the settings.
import { describe, expect, it } from "vitest";
import { BS_LINES, PL_LINES, flagChange, highlightsOf, lineTone, rowKind, wrongSide, DEFAULT_HIGHLIGHTS, MARK_COLORS } from "@/lib/engine/statement-rows";

describe("statement lines", () => {
  it("P&L lines run from revenue to net income, with costs marked", () => {
    expect(PL_LINES[0].k).toBe("revenue");
    expect(PL_LINES.at(-1)!.k).toBe("net_income");
    expect(PL_LINES.find((r) => r.k === "cos")!.cost).toBe(true);
  });
  it("balance sheet lines end with total liabilities and equity", () => {
    expect(BS_LINES.at(-1)!.k).toBe("tle");
  });
  it("grand totals are shaded more strongly than subtotals", () => {
    expect(rowKind("net_income")).toBe("grand");
    expect(rowKind("ta")).toBe("grand");
    expect(rowKind("tle")).toBe("grand");
    expect(rowKind("gross_profit")).toBe("total");
    expect(rowKind("tca")).toBe("total");
    expect(rowKind("revenue")).toBe("line");
  });
});

describe("better or worse", () => {
  it("income up is better, cost up is worse", () => {
    expect(lineTone("PL", "revenue", 120, 100)).toBe("better");
    expect(lineTone("PL", "revenue", 80, 100)).toBe("worse");
    expect(lineTone("PL", "cos", 120, 100)).toBe("worse");
    expect(lineTone("PL", "cos", 80, 100)).toBe("better");
  });
  it("a loss getting smaller is better", () => {
    expect(lineTone("PL", "net_income", -50, -100)).toBe("better");
  });
  it("on the balance sheet, cash and equity up are better, debt up is worse, the rest neutral", () => {
    expect(lineTone("BS", "cash", 120, 100)).toBe("better");
    expect(lineTone("BS", "te", 90, 100)).toBe("worse");
    expect(lineTone("BS", "ltd", 120, 100)).toBe("worse");
    expect(lineTone("BS", "std", 80, 100)).toBe("better");
    expect(lineTone("BS", "ar", 120, 100)).toBe("neutral");
  });
  it("no comparison, or no change, is neutral", () => {
    expect(lineTone("PL", "revenue", 120, null)).toBe("neutral");
    expect(lineTone("PL", "revenue", 100, 100)).toBe("neutral");
  });
});

describe("attention flags", () => {
  const th = { pct: 25, amount: 50_000 };
  it("flags a move over both the percentage and the amount", () => {
    expect(flagChange(260_000, 200_000, th)).toBe(true); // +30%, +60,000
    expect(flagChange(140_000, 200_000, th)).toBe(true); // -30%, -60,000
  });
  it("does not flag a large percentage on a small amount", () => {
    expect(flagChange(13_000, 10_000, th)).toBe(false); // +30%, +3,000
  });
  it("does not flag a large amount that is a small percentage", () => {
    expect(flagChange(21_000_000, 20_000_000, th)).toBe(false); // +5%, +1M
  });
  it("a line that appears from nothing is flagged when large enough", () => {
    expect(flagChange(80_000, 0, th)).toBe(true);
    expect(flagChange(80_000, null, th)).toBe(false);
    expect(flagChange(10_000, 0, th)).toBe(false);
  });
  it("assets and liabilities on the wrong side are flagged; equity may be negative", () => {
    expect(wrongSide("ar", -5000)).toBe(true);
    expect(wrongSide("ap", -5000)).toBe(true);
    expect(wrongSide("ar", 5000)).toBe(false);
    expect(wrongSide("retained_earnings", -5000)).toBe(false);
    expect(wrongSide("ar", -0.5)).toBe(false);
  });
});

describe("highlight settings", () => {
  it("defaults to 25% and EGP 50,000 with no marks", () => {
    expect(highlightsOf({})).toEqual(DEFAULT_HIGHLIGHTS);
    expect(DEFAULT_HIGHLIGHTS).toEqual({ pct: 25, amount: 50_000, lines: {} });
  });
  it("keeps valid values and drops bad ones", () => {
    const h = highlightsOf({ highlights: { pct: 10, amount: -3, lines: { gross_profit: { color: "yellow", note: "watch" }, bad: { color: "purple" }, cash: "x" } } });
    expect(h.pct).toBe(10);
    expect(h.amount).toBe(50_000);
    expect(h.lines).toEqual({ gross_profit: { color: "yellow", note: "watch" } });
  });
  it("offers five mark colours", () => {
    expect(MARK_COLORS).toEqual(["yellow", "green", "blue", "pink", "grey"]);
  });
});

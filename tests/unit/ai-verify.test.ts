// Every number in an AI answer must be one of the figures the system gave it (within rounding), or the answer is not
// shown. This is what makes "Ask your numbers" and "Explain" safe to read: the AI words it, the books supply the numbers.
import { describe, expect, it } from "vitest";
import { numbersIn, verifyFigures, type Fact } from "@/lib/ai/verify";

const facts: Fact[] = [
  { id: "revenue", label: "Revenue, Sep 2026", value: 1_234_567.89, unit: "EGP" },
  { id: "gpm", label: "Gross margin, Sep 2026", value: 38.4, unit: "%" },
  { id: "dso", label: "Customer days", value: 74, unit: "days" },
  { id: "top", label: "Largest customer's share", value: 0.226, unit: "ratio" },
];

describe("numbers in a text", () => {
  it("are read with thousands separators, decimals, percentages, Arabic digits and K/M shorthands", () => {
    expect(numbersIn("Revenue was 1,234,568 EGP and margin 38.4%.")).toEqual([1234568, 38.4]);
    expect(numbersIn("الإيرادات ١٬٢٣٤٬٥٦٨ جنيه والهامش ٣٨٫٤٪")).toEqual([1234568, 38.4]);
    expect(numbersIn("about 1.23M, or 1,235K")).toEqual([1_230_000, 1_235_000]);
  });
});

describe("the figure check", () => {
  it("passes an answer whose numbers all come from the facts (rounded as people write them)", () => {
    expect(verifyFigures("Revenue was EGP 1.23M in Sep 2026, with a 38% gross margin; customers take 74 days to pay.", facts)).toEqual({ ok: true, unknown: [] });
    expect(verifyFigures("The largest customer is 22.6% of sales.", facts).ok).toBe(true);
  });

  it("refuses an answer with a number the books never gave", () => {
    const r = verifyFigures("Revenue was 1,500,000 and margin 38.4%.", facts);
    expect(r.ok).toBe(false);
    expect(r.unknown).toEqual([1_500_000]);
  });

  it("lets through dates, the year and small counts that are words, not figures", () => {
    expect(verifyFigures("In the 3 months to Sep 2026 (30 September 2026), revenue was 1,234,568.", facts).ok).toBe(true);
  });

  it("does not accept a rounding so loose that it hides a different figure", () => {
    expect(verifyFigures("Revenue was 1.3M.", facts).ok).toBe(false);
  });
});

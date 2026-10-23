import { describe, expect, it } from "vitest";
import { modeOf, openingCashOf, withMode, withOpeningCash } from "@/lib/company/mode";

describe("company mode (Simple / Full)", () => {
  it("a company with no mode set is Full, so existing companies are untouched", () => {
    expect(modeOf({})).toBe("full");
    expect(modeOf(null)).toBe("full");
    expect(modeOf({ profile: { booksStart: "2021-07-01" } })).toBe("full");
  });
  it("reads Simple, and anything unknown stays Full", () => {
    expect(modeOf({ profile: { mode: "simple" } })).toBe("simple");
    expect(modeOf({ profile: { mode: "weird" } })).toBe("full");
  });
  it("switching mode keeps every other setting", () => {
    const cfg = { gpm: { target: 30 }, profile: { booksStart: "2021-07-01", timeZone: "Africa/Cairo" } };
    const s = withMode(cfg, "simple");
    expect(modeOf(s)).toBe("simple");
    expect(s).toEqual({ gpm: { target: 30 }, profile: { booksStart: "2021-07-01", timeZone: "Africa/Cairo", mode: "simple" } });
    expect(modeOf(withMode(s, "full"))).toBe("full");
  });
});

describe("opening cash", () => {
  it("none until set", () => expect(openingCashOf({})).toBeNull());
  it("an amount on a day", () => {
    const cfg = withOpeningCash({}, { amount: 250000, asOf: "2026-01-01" });
    expect(openingCashOf(cfg)).toEqual({ amount: 250000, asOf: "2026-01-01" });
  });
  it("a broken value is ignored, never read as zero", () => {
    expect(openingCashOf({ profile: { openingCash: { amount: "x", asOf: "2026-01-01" } } })).toBeNull();
    expect(openingCashOf({ profile: { openingCash: { amount: 5, asOf: "01/01/2026" } } })).toBeNull();
  });
  it("cleared with null", () => expect(openingCashOf(withOpeningCash({ profile: { openingCash: { amount: 1, asOf: "2026-01-01" } } }, null))).toBeNull());
});

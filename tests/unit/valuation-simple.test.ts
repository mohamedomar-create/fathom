import { describe, expect, it } from "vitest";
import { val } from "@/lib/i18n/areas/val";

const [en, ar] = Array.isArray(val) ? val : [(val as { en: unknown }).en, (val as { ar: unknown }).ar];
const texts = (o: unknown): string[] => typeof o === "string" ? [o] : typeof o === "function" ? [String((o as (...a: string[]) => string)("X", "Y"))]
  : Array.isArray(o) ? o.flatMap(texts) : o && typeof o === "object" ? Object.values(o).flatMap(texts) : [];

describe("the simple valuation view speaks plainly", () => {
  it("uses no expert terms in English", () => {
    const s = texts((en as { simple: unknown }).simple).join(" \n ");
    for (const w of ["WACC", "EBITDA", "DCF", "terminal", "multiple", "equity", "enterprise value", "P/E", "SDE", "normalis"]) expect(s, w).not.toMatch(new RegExp(w, "i"));
  });
  it("names every method and the new ways in plain words, in both languages", () => {
    for (const lang of [en, ar] as { simple: { methods: Record<string, unknown>; ask: Record<string, unknown> } }[]) {
      expect(Object.keys(lang.simple.methods).sort()).toEqual(["adjustedAssets", "bookAssets", "capitalised", "dcf", "ebitda", "liquidation", "pe", "sales", "sde"]);
      expect(Object.keys(lang.simple.ask).sort()).toEqual(["berkus", "future", "pitch", "scorecard", "strategic"]);
    }
  });
  it("the sector is named Valuation", () => {
    expect((en as { title: string }).title).toBe("Valuation");
    expect((ar as { title: string }).title).toBe("التقييم");
  });
});

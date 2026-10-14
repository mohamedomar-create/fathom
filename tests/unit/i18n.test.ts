import { describe, expect, it } from "vitest";
import { ar } from "@/lib/i18n/ar";
import { en } from "@/lib/i18n/en";
import { dirOf, htmlLang, monthLabel, parseLang, periodLabel } from "@/lib/i18n";
import { SECTORS } from "@/components/shell/nav";

/** Every string in a dictionary, with its path, calling the phrase functions with sample values. */
function strings(o: unknown, path = ""): [string, string][] {
  if (typeof o === "string") return [[path, o]];
  if (typeof o === "function") return [[path, String((o as (...a: unknown[]) => unknown)(3, "X"))]];
  if (Array.isArray(o)) return o.flatMap((v, i) => strings(v, `${path}[${i}]`));
  if (o && typeof o === "object") return Object.entries(o).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k));
  return [];
}

describe("languages", () => {
  it("reads the cookie safely and sets the page direction", () => {
    expect(parseLang("ar")).toBe("ar");
    expect(parseLang("fr")).toBe("en");
    expect(parseLang(undefined)).toBe("en");
    expect(dirOf("ar")).toBe("rtl");
    expect(htmlLang("ar")).toBe("ar-EG");
  });

  it("has the same words in Arabic as in English, each written in Arabic", () => {
    const e = new Map(strings(en)), a = new Map(strings(ar));
    expect([...a.keys()].sort()).toEqual([...e.keys()].sort());
    // Words that are names in either script (the switch offers the other language by its own name).
    const keep = new Set(["lang.switchTo", "lang.name"]);
    for (const [k, v] of a) {
      if (keep.has(k) || !/\p{L}/u.test(v)) continue; // punctuation alone
      expect(/[؀-ۿ]/.test(v), `${k} is not in Arabic: ${v}`).toBe(true);
    }
  });

  it("names every page of the side menu and settings in both languages", () => {
    for (const s of SECTORS) for (const n of s.items) {
      expect(en.nav[n.href], n.href).toBeDefined();
      expect(ar.nav[n.href], n.href).toBeDefined();
      expect(en.nav[n.href][0]).toBe(n.label);
      expect(en.nav[n.href][1]).toBe(n.title);
    }
  });

  it("writes months, quarters and years in Arabic", () => {
    expect(monthLabel("2026-09", "ar")).toBe("سبتمبر 2026");
    expect(monthLabel("2026-09", "en")).toBe("Sep 2026");
    expect(periodLabel("Sep 2026", "ar")).toBe("سبتمبر 2026");
    expect(periodLabel("Q3 2026", "ar")).toBe("الربع الثالث 2026");
    expect(periodLabel("Q3 2026 (to Aug)", "ar")).toBe("الربع الثالث 2026 (حتى أغسطس)");
    expect(periodLabel("Year 2026", "ar")).toBe("سنة 2026");
    expect(periodLabel("FY2026", "ar")).toBe("السنة المالية 2026");
    expect(periodLabel("Q2 FY2026", "ar")).toBe("الربع الثاني من السنة المالية 2026");
    expect(periodLabel("Q3 2026 (to Aug)", "en")).toBe("Q3 2026 (to Aug)");
  });
});

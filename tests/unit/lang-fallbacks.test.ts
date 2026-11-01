// 4b review fixes: text written in one language never replaces the other language's text for other readers.
import { describe, expect, it } from "vitest";
import { inLang } from "@/lib/i18n/script";
import { titleToStore } from "@/lib/report/title";
import { isMemoHeading } from "@/lib/ai/memo-headings";
import { systemPrompt } from "@/lib/ai/context";

describe("stored commentary is shown only in the language it was written in", () => {
  it("English text for English readers, Arabic for Arabic readers, otherwise nothing (the automatic notes show)", () => {
    expect(inLang("Revenue grew 12%.", "en")).toBe("Revenue grew 12%.");
    expect(inLang("Revenue grew 12%.", "ar")).toBeUndefined();
    expect(inLang("نمت الإيرادات 12%.", "ar")).toBe("نمت الإيرادات 12%.");
    expect(inLang("نمت الإيرادات 12%.", "en")).toBeUndefined();
    expect(inLang(undefined, "en")).toBeUndefined();
  });
});

describe("the report title", () => {
  it("the Arabic default title is saved as the English default, so English readers keep theirs", () => {
    expect(titleToStore("تقرير الأداء الشهري", "تقرير الأداء الشهري")).toBe("Monthly Performance Report");
    expect(titleToStore("  تقرير الأداء الشهري ", "تقرير الأداء الشهري")).toBe("Monthly Performance Report");
    expect(titleToStore("Board pack Q3", "تقرير الأداء الشهري")).toBe("Board pack Q3");
  });
});

describe("the Arabic bank memo headings", () => {
  it("every heading the Arabic prompt asks for is recognised as a heading", () => {
    const p = systemPrompt("ar");
    const asked = [...p.matchAll(/"([؀-ۿ][^"]+)" \((Lead with|Risks and how to answer them|What to ask for|Questions to expect)\)/g)].map((m) => m[1]);
    expect(asked).toHaveLength(4);
    for (const h of asked) expect(isMemoHeading(h)).toBe(true);
    expect(isMemoHeading("المخاطر وكيف ترد عليها:")).toBe(true);
    expect(isMemoHeading("Lead with")).toBe(true);
    expect(isMemoHeading("نمت الإيرادات")).toBe(false);
  });
});

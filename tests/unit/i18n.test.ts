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

describe("part-month labels", () => {
  it("names the last day in Arabic", () => {
    expect(periodLabel("Year 2026 (to 10 Oct)", "ar")).toBe("سنة 2026 (حتى 10 أكتوبر)");
    expect(periodLabel("Oct 2026 (to 10 Oct)", "ar")).toBe("أكتوبر 2026 (حتى 10 أكتوبر)");
  });
});

describe("analysis in Arabic", async () => {
  const sample = (await import("../../reference/sample.json")).default;
  const { analyze, KPI_DEFS, bsCalc, plCalc, cashWaterfall, cashFlowStatement, CAT_ORDER } = await import("@/lib/engine");
  const { LINES_AR } = await import("@/lib/i18n/lines");
  const { KPI_AR } = await import("@/lib/i18n/kpis");
  const months = sample.months as import("@/lib/engine").MonthData[];
  const settings = { currency: "EGP", fyStartMonth: 1, taxRate: 0.225, targets: sample.targets };

  it("names every KPI and KPI group in Arabic", () => {
    for (const d of KPI_DEFS) expect(KPI_AR[d.key], d.key).toBeDefined();
    for (const c of CAT_ORDER) expect(LINES_AR[c], c).toBeDefined();
  });

  it("names every cash-flow line and its explanation in Arabic", () => {
    const B0 = bsCalc(months[0].bs), B = bsCalc({ ...months[1].bs, cash: (months[1].bs.cash ?? 0) + 1 }), P = plCalc({ ...months[1].pl, adjustments: 5 });
    const W = cashWaterfall(P, B, B0);
    for (const r of W.rows) { expect(LINES_AR[r.label], r.label).toBeDefined(); if (r.info) expect(LINES_AR[r.info], r.info).toBeDefined(); }
    for (const l of cashFlowStatement(P, B, B0, { showUnreconciled: true }).lines) expect(LINES_AR[l.label], l.label).toBeDefined();
  });

  it("writes the analyst notes in Arabic with the same figures, and leaves English as it was", () => {
    const sel = { type: "month" as const, end: "2026-09" };
    const en = analyze(months, sel, settings).findings;
    const ar = analyze(months, sel, settings, { lang: "ar" }).findings;
    expect(ar.length).toBe(en.length);
    expect(ar.map((f) => [f.kind, f.section, f.sev])).toEqual(en.map((f) => [f.kind, f.section, f.sev]));
    for (const f of ar) {
      expect(/[؀-ۿ]/.test(f.title), f.title).toBe(true);
      expect(/[A-Za-z]{4,}/.test(f.title.replace(/EGP/g, "")), `English left in: ${f.title}`).toBe(false);
    }
    // Every amount in the English notes appears in the Arabic ones.
    const amounts = (fs: typeof en) => fs.flatMap((f) => `${f.title} ${f.text}`.match(/EGP [\d,]+/g) ?? []).sort();
    expect(amounts(ar)).toEqual(amounts(en));
    expect(en.find((f) => f.title.startsWith("Revenue"))).toBeDefined();
  });
});

import { describe, expect, it } from "vitest";
import { ar } from "@/lib/i18n/ar";
import { en } from "@/lib/i18n/en";
import { dirOf, htmlLang, monthLabel, parseLang, periodLabel } from "@/lib/i18n";
import { SECTORS } from "@/components/shell/nav";

/** Every string in a dictionary, with its path, calling the phrase functions with sample values. */
function strings(o: unknown, path = ""): [string, string][] {
  if (typeof o === "string") return [[path, o]];
  if (typeof o === "function") return [[path, String((o as (...a: unknown[]) => unknown)(3, "X", 3, 3, 3, 3, 3, 3))]];
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

  it("names every IAS 7 line (accounts with sub-classes) in Arabic", () => {
    const B0 = bsCalc(months[0].bs), B = bsCalc(months[1].bs), P = plCalc(months[1].pl);
    const all = { interest_payable: 1, dividends_payable: 1, income_tax_payable: 1, provisions: 1, end_of_service: 1, deferred_tax: 1, lease_liability: 1, rou_asset: 1 };
    const sub = { p: { disposal_gain: 5, fx_unrealised: 3, rou_depreciation: 1 }, b: all, b0: {}, of: {}, of0: {} };
    const W = cashWaterfall(P, B, B0, sub);
    for (const r of W.rows) { expect(LINES_AR[r.label], r.label).toBeDefined(); if (r.info) expect(LINES_AR[r.info], r.info).toBeDefined(); }
    for (const l of cashFlowStatement(P, B, B0, { sub }).lines) expect(LINES_AR[l.label], l.label).toBeDefined();
    const est = cashFlowStatement(plCalc({ interest_expenses: 1, dividends: 1, tax_expenses: 1 }), B, B0).estimated;
    expect(est.length).toBe(3);
    for (const e of est) expect(LINES_AR[e], e).toBeDefined();
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

describe("sales and expenses in Arabic", async () => {
  const sample = (await import("../../reference/sample.json")).default;
  const { salesAnalysis, expensesAnalysis } = await import("@/lib/engine");
  const { demoSales } = await import("@/lib/company/demo-sales");
  const { demoExpenses } = await import("@/lib/company/demo-expenses");
  const { spreadAccounts } = await import("@/lib/company/demo");
  const months = sample.months as import("@/lib/engine").MonthData[];
  const sel = { type: "month" as const, end: "2026-09" };
  const arabic = (s: string) => /[؀-ۿ]/.test(s);

  it("writes the sales notes in Arabic, the same ones as in English", () => {
    const en = salesAnalysis(demoSales(), sel, 1), ar = salesAnalysis(demoSales(), sel, 1, { lang: "ar" });
    expect(ar.findings.map((f) => f.kind)).toEqual(en.findings.map((f) => f.kind));
    expect(ar.findings.length).toBeGreaterThan(0);
    for (const f of ar.findings) expect(arabic(f.title), f.title).toBe(true);
    for (const n of ar.notes) expect(arabic(n), n).toBe(true);
    expect(ar.total).toBe(en.total);
  });

  it("writes the expenses notes in Arabic, the same ones as in English", () => {
    const accts = spreadAccounts(months) as import("@/lib/engine").ExpenseAccount[];
    const en = expensesAnalysis(accts, demoExpenses(), sel, 1), ar = expensesAnalysis(accts, demoExpenses(), sel, 1, { lang: "ar" });
    expect(ar.findings.map((f) => f.kind)).toEqual(en.findings.map((f) => f.kind));
    expect(ar.findings.length).toBeGreaterThan(0);
    for (const f of ar.findings) expect(arabic(f.title), f.title).toBe(true);
    expect(ar.total).toBe(en.total);
    expect(ar.bridge.map((b) => b.delta)).toEqual(en.bridge.map((b) => b.delta));
  });
});

describe("bank readiness, real profit and forecast in Arabic", async () => {
  const sample = (await import("../../reference/sample.json")).default;
  const { bankPack, formatBankValue, realProfit, realProfitSummary, twelveMonths, forecast, METHOD_LABEL, METHOD_LABEL_AR, METHOD_ABOUT_AR, REQUEST_LABEL_AR, BANK_CHECKLIST, BANK_CHECKLIST_AR } = await import("@/lib/engine");
  const months = sample.months as import("@/lib/engine").MonthData[];
  const settings = { currency: "EGP", fyStartMonth: sample.fy_start_month, taxRate: sample.tax_rate };
  const a = { inflation: 20, fxStart: 49, fxEnd: 48.5, importShare: 40, assetAge: 3, rate: 24, tenor: 5, requestAmount: 2_000_000, requestType: "term_loan" as const };
  const arabic = (s: string) => /[؀-ۿ]/.test(s);
  // Acronyms bankers use in Arabic too (DSCR, EBITDA, EGP) are allowed; English words are not.
  const english = (s: string) => /[A-Za-z]{4,}/.test(s.replace(/\b[A-Z]{2,}\b/g, ""));

  it("writes every bank ratio, flag, scenario and the memo in Arabic, with the same figures", () => {
    const en = bankPack(months, "2026-09", settings, a, "شركة العرض", undefined, "en");
    const ar = bankPack(months, "2026-09", settings, a, "شركة العرض", undefined, "ar");
    expect(ar.assessment.ratios.map((r) => [r.key, r.value, r.band])).toEqual(en.assessment.ratios.map((r) => [r.key, r.value, r.band]));
    for (const r of ar.assessment.ratios) {
      for (const s of [r.name, r.guide, r.banker, r.advice]) { expect(arabic(s), s).toBe(true); expect(english(s), `English left in: ${s}`).toBe(false); }
      expect(formatBankValue(r, "EGP", "ar")).not.toMatch(/days|times/);
    }
    expect(ar.assessment.flags.map((f) => f.key)).toEqual(en.assessment.flags.map((f) => f.key));
    for (const f of ar.assessment.flags) expect(arabic(f.title) && arabic(f.detail) && arabic(f.advice), f.title).toBe(true);
    expect(ar.stress.scenarios.map((s) => [s.key, s.dscr])).toEqual(en.stress.scenarios.map((s) => [s.key, s.dscr]));
    for (const s of ar.stress.scenarios) expect(arabic(s.name) && arabic(s.detail), s.name).toBe(true);
    for (const r of ar.trend.rows) expect(arabic(r.name), r.name).toBe(true);
    for (const y of ar.trend.years) expect(y.label).toMatch(/^12 شهرًا حتى /);
    expect(ar.memo).toContain("ابدأ بـ");
    expect(english(ar.memo), ar.memo).toBe(false);
    // The English memo is unchanged by the Arabic option.
    expect(en.memo).toContain("Lead with");
    expect(Object.values(REQUEST_LABEL_AR).every(arabic)).toBe(true);
    expect(BANK_CHECKLIST_AR.length).toBe(BANK_CHECKLIST.length);
    for (const c of BANK_CHECKLIST_AR) expect(arabic(c.item) && arabic(c.why)).toBe(true);
  });

  it("writes the real-profit bridge and its summary in Arabic", () => {
    const b = twelveMonths(months, "2026-09", 1);
    const en = realProfit(b, a, "EGP", 45, "en"), ar = realProfit(b, a, "EGP", 45, "ar");
    expect(ar.inflation!.steps.map((s) => s.value)).toEqual(en.inflation!.steps.map((s) => s.value));
    for (const s of ar.inflation!.steps) expect(arabic(s.label) && arabic(s.explain), s.label).toBe(true);
    const sum = realProfitSummary(ar, "EGP", "ar");
    expect(arabic(sum) && !english(sum), sum).toBe(true);
  });

  it("writes the forecast notes and method names in Arabic", () => {
    const en = forecast(months, settings, {}, a, undefined, "en"), ar = forecast(months, settings, {}, a, undefined, "ar");
    expect(en.ok && ar.ok).toBe(true);
    if (!en.ok || !ar.ok) return;
    expect(ar.months.map((m) => m.P.revenue)).toEqual(en.months.map((m) => m.P.revenue));
    for (const n of ar.notes) expect(arabic(n), n).toBe(true);
    for (const k of Object.keys(METHOD_LABEL) as (keyof typeof METHOD_LABEL)[]) expect(arabic(METHOD_LABEL_AR[k]) && arabic(METHOD_ABOUT_AR[k])).toBe(true);
    const short = forecast(months.slice(0, 2), settings, {}, a, undefined, "ar");
    if (!short.ok) expect(arabic(short.reason), short.reason).toBe(true);
  });

  it("names the twelve-month basis in Arabic", () => {
    expect(periodLabel("12 months to Sep 2026", "ar")).toBe("12 شهرًا حتى سبتمبر 2026");
    expect(periodLabel("5 months to Jun 2026 (2 months missing)", "ar")).toBe("5 أشهر حتى يونيو 2026 (ناقص شهران)");
    expect(periodLabel("11 months to Jun 2026 (Mar 2026 missing)", "ar")).toBe("11 شهرًا حتى يونيو 2026 (ناقص مارس 2026)");
  });
});

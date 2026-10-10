import { describe, expect, it } from "vitest";
import { chartHints, classify } from "@/lib/ingest/classify";
import { normAr } from "@/lib/ingest/parse";

describe("Arabic spelling variants", () => {
  it("normalises hamza, taa marbuta, alef maqsura, diacritics and tatweel", () => {
    expect(normAr("الأصول الثابتـة")).toBe("الاصول الثابته");
    expect(normAr("إيرادات أخرى")).toBe("ايرادات اخري");
    expect(normAr("مُرَتَّبَات")).toBe("مرتبات");
    expect(normAr("مسؤولية")).toBe("مسووليه");
  });

  it("classifies the same account whichever way it is spelled", () => {
    for (const [a, b, cls] of [
      ["رأس المال", "راس المال", "other_equity"],
      ["الأرباح المرحلة", "الارباح المرحله", "retained_earnings"],
      ["مصروفات مستحقة", "مصروفات مستحقه", "other_cl"],
      ["إيرادات أخرى", "ايرادات اخرى", "other_income"],
      ["تكلفة المبيعات", "تكلفه المبيعات", "cos_variable"],
      ["مجمع إهلاك السيارات", "مجمع اهلاك السيارات", "fixed_assets"],
      ["ضريبة القيمة المضافة", "ضريبه القيمه المضافه", "tax_liab"],
    ] as const) {
      const st = /رأس|راس|الأرباح|الارباح|مستحق|مجمع|ضريب/.test(a) ? "BS" : "PL";
      expect(classify(a, "", st).cls, a).toBe(cls);
      expect(classify(b, "", st).cls, b).toBe(cls);
    }
  });

  it("reads section headings with either spelling", () => {
    expect(classify("حساب غير معروف", "الاصول", "BS").cls).toBe("other_ca");
    expect(classify("بند تشغيلي", "تكلفه الايرادات", "PL").cls).toBe("cos_variable");
  });
});

// A typical Egyptian unified chart (النظام المحاسبي الموحد): 1 assets, 2 equity and liabilities, 3 expenses, 4 revenues.
const UNIFIED: [string, string, string][] = [
  ["1101", "أراضي", "fixed_assets"],
  ["1102", "مباني وإنشاءات", "fixed_assets"],
  ["1109", "مجمع إهلاك الأصول الثابتة", "fixed_assets"],
  ["1201", "مشروعات تحت التنفيذ", "fixed_assets"],
  ["1301", "استثمارات في شركات تابعة", "investments"],
  ["1401", "مخزون خامات", "inventory"],
  ["1501", "العملاء", "ar"],
  ["1601", "مصروفات مدفوعة مقدماً", "other_ca"],
  ["1801", "النقدية بالصندوق", "cash"],
  ["1802", "البنك الأهلي - حساب جاري", "cash"],
  ["2101", "رأس المال المدفوع", "other_equity"],
  ["2201", "احتياطي قانوني", "other_equity"],
  ["2401", "قروض طويلة الأجل", "ltd"],
  ["2501", "بنوك سحب على المكشوف", "std"],
  ["2601", "الموردين", "ap"],
  ["2701", "مصلحة الضرائب - ضريبة القيمة المضافة", "tax_liab"],
  ["2702", "دائنون متنوعون", "other_cl"],
  ["3101", "الأجور النقدية", "exp_fixed"],
  ["3102", "مرتبات الإدارة", "exp_fixed"],
  ["3201", "خامات ومواد أولية", "cos_variable"],
  ["3202", "وقود وزيوت", "cos_variable"],
  ["3301", "صيانة", "exp_fixed"],
  ["3302", "دعاية وإعلان", "exp_fixed"],
  ["3401", "مشتريات بغرض البيع", "cos_variable"],
  ["3501", "إهلاكات الأصول الثابتة", "exp_depreciation"],
  ["3502", "فوائد قروض", "interest_expenses"],
  ["4101", "مبيعات إنتاج تام", "revenue"],
  ["4102", "إيرادات خدمات مباعة", "revenue"],
  ["4501", "إيرادات أوراق مالية", "other_income"],
  ["4601", "فوائد دائنة", "interest_income"],
  ["4701", "إيرادات متنوعة", "other_income"],
];

describe("Egypt's unified chart of accounts", () => {
  const chart = chartHints(UNIFIED.map(([code, name]) => ({ code, name })));

  it("is recognised from its 3xxx expense accounts", () => {
    expect(chart.unified).toBe(true);
  });

  it("places every account by name and code group", () => {
    for (const [code, name, cls] of UNIFIED) expect(classify(name, "", null, {}, code, chart).cls, `${code} ${name}`).toBe(cls);
  });

  it("never reads a 3xxx account as equity or a 4xxx account as a cost", () => {
    expect(classify("حساب 3999", "", null, {}, "3999", chart).cls).toBe("exp_fixed");
    expect(classify("حساب 4999", "", null, {}, "4999", chart).cls).toBe("other_income");
    // "إيراد" in an expense name must not make it revenue
    expect(classify("مصروفات تحصيل الإيرادات", "", null, {}, "3305", chart).cls).toBe("exp_fixed");
  });

  it("is not assumed for Odoo-style charts where 3xxx is equity", () => {
    const odoo = chartHints([
      { code: "301000", name: "Capital" }, { code: "302000", name: "Retained Earnings" }, { code: "400000", name: "Sales" },
      { code: "500000", name: "Cost of Goods Sold" }, { code: "600000", name: "Salaries" },
    ]);
    expect(odoo.unified).toBe(false);
    expect(classify("Capital", "", null, {}, "301000", odoo).cls).toBe("other_equity");
  });
});

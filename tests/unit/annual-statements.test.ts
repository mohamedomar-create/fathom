import { describe, expect, it } from "vitest";
import * as XLSX from "@e965/xlsx";
import type { ClassKey } from "@/lib/engine";
import { ingest } from "@/lib/ingest/pipeline";
import { readWorkbook } from "@/lib/ingest/read";

/** Audited statements as handed to a bank: one sheet, P&L then balance sheet, two year columns. */
const EN: (string | number)[][] = [
  ["Delta Trading S.A.E."], ["Income statement for the year ended 31 December 2025"], ["", "Note", "2025", "2024"],
  ["Revenue", 5, 12000000, 9500000], ["Cost of sales", 6, -8000000, -6500000], ["Gross profit", "", 4000000, 3000000],
  ["Selling and distribution expenses", "", -900000, -700000], ["General and administrative expenses", "", -1100000, -1000000],
  ["Depreciation", "", -300000, -250000], ["Finance costs", "", -450000, -300000], ["Profit before tax", "", 1250000, 750000],
  ["Income tax", "", -281250, -168750], ["Net profit for the year", "", 968750, 581250],
  [], ["Statement of financial position as at 31 December 2025"], ["", "", "2025", "2024"],
  ["Property, plant and equipment", "", 2500000, 2300000], ["Inventories", "", 1800000, 1400000], ["Trade receivables", "", 3200000, 2200000],
  ["Cash and cash equivalents", "", 600000, 800000], ["Total assets", "", 8100000, 6700000],
  ["Share capital", "", 2000000, 2000000], ["Retained earnings", "", 2068750, 1100000], ["Total equity", "", 4068750, 3100000],
  ["Long-term loans", "", 900000, 1000000], ["Current portion of long-term loans", "", 300000, 0], ["Bank overdraft", "", 1100000, 900000],
  ["Trade payables", "", 1450000, 1450000], ["Income tax payable", "", 281250, 250000],
  ["Total liabilities", "", 4031250, 3600000], ["Total equity and liabilities", "", 8100000, 6700000],
];
const AR: (string | number)[][] = [
  ["شركة دلتا للتجارة"], ["قائمة الدخل عن السنة المنتهية في 31 ديسمبر 2025"], ["البيان", "2025", "2024"],
  ["المبيعات", 12000000, 9500000], ["تكلفة المبيعات", -8000000, -6500000], ["مجمل الربح", 4000000, 3000000],
  ["مصروفات بيعية وتسويقية", -900000, -700000], ["مصروفات عمومية وإدارية", -1100000, -1000000],
  ["إهلاك الأصول الثابتة", -300000, -250000], ["مصروفات تمويلية", -450000, -300000], ["صافي الربح قبل الضرائب", 1250000, 750000],
  ["ضريبة الدخل", -281250, -168750], ["صافي ربح العام", 968750, 581250],
  [], ["قائمة المركز المالي في 31 ديسمبر 2025"], ["البيان", "2025", "2024"],
  ["الأصول الثابتة", 2500000, 2300000], ["المخزون", 1800000, 1400000], ["العملاء", 3200000, 2200000],
  ["النقدية بالبنوك والصندوق", 600000, 800000], ["إجمالي الأصول", 8100000, 6700000],
  ["رأس المال", 2000000, 2000000], ["أرباح مرحلة", 2068750, 1100000], ["إجمالي حقوق الملكية", 4068750, 3100000],
  ["قروض طويلة الأجل", 1200000, 1000000], ["بنوك سحب على المكشوف", 1100000, 900000],
  ["الموردين", 1450000, 1450000], ["ضريبة الدخل المستحقة", 281250, 250000],
  ["إجمالي الالتزامات", 4031250, 3600000], ["إجمالي حقوق الملكية والالتزامات", 8100000, 6700000],
];

async function read(rows: (string | number)[][]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "FS");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return ingest(await readWorkbook(buf, "fs.xlsx"), { fyStart: 1, ytd: "auto", closeEarnings: "auto", plugEquity: false, mapping: {}, today: "2026-10-10" });
}
function totals(res: Awaited<ReturnType<typeof read>>, p: string) {
  const t: Partial<Record<ClassKey, number>> = {};
  for (const l of res.lines) if (l.cls && !l.excluded) t[l.cls] = (t[l.cls] ?? 0) + (l.values[p] ?? 0);
  return t;
}

describe("audited annual statements (bank submission files)", () => {
  for (const [lang, rows, ltd, std] of [["English", EN, 900000, 1400000], ["Arabic", AR, 1200000, 1100000]] as const) {
    it(`${lang}: places loans, tax payable and tax expense on the right statement and balances both years`, async () => {
      const res = await read(rows as (string | number)[][]);
      expect(res.imbalance["2025-12"]).toBeCloseTo(0, 2);
      expect(res.imbalance["2024-12"]).toBeCloseTo(0, 2);
      const t = totals(res, "2025-12");
      expect(t.revenue).toBe(12000000);
      expect(t.tax_expenses).toBe(281250);
      expect(t.interest_expenses).toBe(450000);
      expect(t.tax_liab).toBe(281250);
      expect(t.ltd).toBe(ltd);
      expect(t.std).toBe(std);
      expect(t.ar).toBe(3200000);
      expect(totals(res, "2024-12").ltd).toBe(1000000);
    });
  }
});

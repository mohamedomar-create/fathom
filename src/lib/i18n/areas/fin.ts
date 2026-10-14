import { area } from "../types";

/** Financial terms shared by every page: statement lines, ratios and their groups (Egyptian accounting usage). */
export const fin = area(
  {
    revenue: "Revenue", cos: "Cost of Sales", expenses: "Expenses", gross_profit: "Gross Profit", net_income: "Net Profit", ebitda: "EBITDA",
    operating_profit: "Operating Profit", gpm: "Gross Profit Margin", nim: "Net Income Margin", opm: "Operating Profit Margin", ebitda_margin: "EBITDA Margin",
    cash: "Cash on Hand", ocf: "Operating Cash Flow", fcf: "Free Cash Flow", ncf: "Net Cash Flow", inventory: "Inventory", tca: "Current Assets",
    tnca: "Non-Current Assets", ta: "Total Assets", tcl: "Current Liabilities", tncl: "Non-Current Liabilities", tl: "Total Liabilities", tax_liab: "Tax Liability",
    ar: "Accounts Receivable", ap: "Accounts Payable", ar_days: "AR Days", ap_days: "AP Days", current: "Current Ratio", inv_days: "Inventory Days",
    ccc: "Cash Conversion Cycle", quick: "Quick Ratio", wip: "Work in Progress", debt: "Total Debt", te: "Total Equity", debt_equity: "Debt to Equity",
    roce: "Return On Capital Employed", roe: "Return On Equity",
    groups: {
      "Revenue & Expenses": "Revenue & Expenses", Profitability: "Profitability", "Cash Flow": "Cash Flow", Assets: "Assets", Liabilities: "Liabilities",
      "Working Capital": "Working Capital", "Debt & Equity": "Debt & Equity",
    } as Record<string, string>,
    days: (n: string) => `${n} days`,
    times: (n: string) => `${n} times`,
  },
  {
    revenue: "الإيرادات", cos: "تكلفة المبيعات", expenses: "المصروفات", gross_profit: "مجمل الربح", net_income: "صافي الربح", ebitda: "الأرباح قبل الفوائد والضرائب والإهلاك",
    operating_profit: "ربح التشغيل", gpm: "هامش مجمل الربح", nim: "هامش صافي الربح", opm: "هامش ربح التشغيل", ebitda_margin: "هامش الأرباح قبل الفوائد والضرائب والإهلاك",
    cash: "النقدية المتاحة", ocf: "التدفق النقدي التشغيلي", fcf: "التدفق النقدي الحر", ncf: "صافي التدفق النقدي", inventory: "المخزون", tca: "الأصول المتداولة",
    tnca: "الأصول غير المتداولة", ta: "إجمالي الأصول", tcl: "الالتزامات المتداولة", tncl: "الالتزامات غير المتداولة", tl: "إجمالي الالتزامات", tax_liab: "التزامات ضريبية",
    ar: "العملاء والمدينون", ap: "الموردون والدائنون", ar_days: "أيام التحصيل", ap_days: "أيام السداد للموردين", current: "نسبة التداول", inv_days: "أيام المخزون",
    ccc: "دورة التحويل النقدي", quick: "نسبة السيولة السريعة", wip: "إنتاج تحت التشغيل", debt: "إجمالي الديون", te: "إجمالي حقوق الملكية", debt_equity: "الديون إلى حقوق الملكية",
    roce: "العائد على رأس المال المستخدم", roe: "العائد على حقوق الملكية",
    groups: {
      "Revenue & Expenses": "الإيرادات والمصروفات", Profitability: "الربحية", "Cash Flow": "التدفق النقدي", Assets: "الأصول", Liabilities: "الالتزامات",
      "Working Capital": "رأس المال العامل", "Debt & Equity": "الديون وحقوق الملكية",
    },
    days: (n: string) => `${n} يوم`,
    times: (n: string) => `${n} مرة`,
  },
);

type Terms = typeof fin.en;
/** A statement line or ratio by its engine key ("gpm", "ar_days"), or the key itself when it has no name here. */
export const term = (t: { [K in keyof Terms]: unknown }, key: string): string => {
  const v = (t as Record<string, unknown>)[key];
  return typeof v === "string" ? v : key;
};

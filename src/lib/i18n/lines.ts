import type { Lang } from ".";

/**
 * Arabic for the fixed names the engine and pages use for statement lines, cash-flow lines, metrics and groups (Egyptian
 * accounting usage). Looked up by the English name, so the engine keeps one language and its tests stay as they are; a unit
 * test checks every name the engine can produce is here.
 */
export const LINES_AR: Record<string, string> = {
  // Profit and loss
  Revenue: "الإيرادات", "Cost of Sales": "تكلفة المبيعات", "Gross Profit": "مجمل الربح", Expenses: "المصروفات", "Operating Profit": "ربح التشغيل",
  "Other Income": "إيرادات أخرى", "Other Expenses": "مصروفات أخرى", "Earnings Before Interest & Tax": "الربح قبل الفوائد والضرائب", "Interest Income": "إيرادات الفوائد",
  "Interest Expenses": "مصروفات الفوائد", "Earnings Before Tax": "الربح قبل الضرائب", "Tax Expenses": "مصروف الضرائب", "Earnings After Tax": "الربح بعد الضرائب",
  "Adjustments (prior-period and one-off items)": "تسويات (بنود سنوات سابقة وبنود غير متكررة)", "Net Income": "صافي الربح", "Retained Income": "الأرباح المحتجزة للفترة",
  "Fixed COS": "تكلفة مبيعات ثابتة", "Variable COS": "تكلفة مبيعات متغيرة", "COS Depreciation": "إهلاك ضمن تكلفة المبيعات", "Fixed Expenses": "مصروفات ثابتة",
  "Variable Expenses": "مصروفات متغيرة", "Depreciation & Amortisation": "الإهلاك والاستهلاك", EBITDA: "الربح قبل الفوائد والضرائب والإهلاك", "Net Interest": "صافي الفوائد",
  EBIT: "الربح قبل الفوائد والضرائب", "Net Profit": "صافي الربح",
  // Balance sheet
  ASSETS: "الأصول", LIABILITIES: "الالتزامات", EQUITY: "حقوق الملكية", "Cash & Equivalents": "النقدية وما في حكمها", "Accounts Receivable": "العملاء والمدينون",
  Inventory: "المخزون", "Work In Progress": "إنتاج تحت التشغيل", "Other Current Assets": "أصول متداولة أخرى", "Total Current Assets": "إجمالي الأصول المتداولة",
  "Fixed Assets": "الأصول الثابتة", "Intangible Assets": "الأصول غير الملموسة", "Investments / Other NCA": "استثمارات / أصول غير متداولة أخرى",
  "Total Non-Current Assets": "إجمالي الأصول غير المتداولة", "Total Assets": "إجمالي الأصول", "Short Term Debt": "قروض قصيرة الأجل", "Accounts Payable": "الموردون والدائنون",
  "Tax Liability": "التزامات ضريبية", "Other Current Liabilities": "التزامات متداولة أخرى", "Total Current Liabilities": "إجمالي الالتزامات المتداولة",
  "Long Term Debt": "قروض طويلة الأجل", "Other Non-Current Liabilities": "التزامات غير متداولة أخرى", "Total Non-Current Liabilities": "إجمالي الالتزامات غير المتداولة",
  "Total Liabilities": "إجمالي الالتزامات", "Retained Earnings": "الأرباح المرحلة", "Other Equity": "حقوق ملكية أخرى", "Total Equity": "إجمالي حقوق الملكية",
  "Total Liabilities & Equity": "إجمالي الالتزامات وحقوق الملكية", "Total Debt": "إجمالي الديون", "Operating Working Capital": "رأس المال العامل التشغيلي",
  // Cash flow
  "Cash Tax Paid": "الضرائب المدفوعة نقدًا", Adjustments: "تسويات", "Change in Accounts Payable": "التغير في الموردين والدائنين",
  "Change in Other Current Liabilities": "التغير في الالتزامات المتداولة الأخرى", "Change in Accounts Receivable": "التغير في العملاء والمدينين",
  "Change in Inventory": "التغير في المخزون", "Change in Work In Progress": "التغير في الإنتاج تحت التشغيل", "Change in Other Current Assets": "التغير في الأصول المتداولة الأخرى",
  "OPERATING CASH FLOW": "التدفق النقدي التشغيلي", "Purchase / Sale of Fixed Assets": "شراء / بيع أصول ثابتة", "Change in Intangible Assets": "التغير في الأصول غير الملموسة",
  "Change in Investments or Other Non-Current Assets": "التغير في الاستثمارات والأصول غير المتداولة الأخرى", "FREE CASH FLOW": "التدفق النقدي الحر",
  "Net Interest Paid": "صافي الفوائد المدفوعة", "Change in Other Non-Current Liabilities": "التغير في الالتزامات غير المتداولة الأخرى", Dividends: "توزيعات الأرباح",
  "Owners' Capital and Other Equity Movements": "رأس مال الملاك وحركات حقوق الملكية الأخرى", "Unreconciled Difference": "فرق غير مُفسَّر",
  "CASH FLOW BEFORE BORROWING": "التدفق النقدي قبل الاقتراض", "Add back Net Interest (shown under financing)": "يُضاف صافي الفوائد (يظهر ضمن التمويل)",
  "Change in Tax Liability": "التغير في الالتزامات الضريبية", "Change in Investments / Other Non-Current Assets": "التغير في الاستثمارات / الأصول غير المتداولة الأخرى",
  "Dividends Paid": "توزيعات أرباح مدفوعة", "Change in Short Term Debt": "التغير في القروض قصيرة الأجل", "Change in Long Term Debt": "التغير في القروض طويلة الأجل",
  "OPERATING ACTIVITIES": "الأنشطة التشغيلية", "Cash Flow from Operating Activities": "التدفق النقدي من الأنشطة التشغيلية", "INVESTING ACTIVITIES": "الأنشطة الاستثمارية",
  "Cash Flow from Investing Activities": "التدفق النقدي من الأنشطة الاستثمارية", "FINANCING ACTIVITIES": "الأنشطة التمويلية",
  "Cash Flow from Financing Activities": "التدفق النقدي من الأنشطة التمويلية", "Unreconciled Difference (balance sheet out of balance)": "فرق غير مُفسَّر (الميزانية غير متوازنة)",
  "Change in Cash & Equivalents": "التغير في النقدية وما في حكمها", "Opening Balance": "الرصيد الافتتاحي", "Closing Balance": "الرصيد الختامي",
  "Operating Cash Flow": "التدفق النقدي التشغيلي", "Free Cash Flow": "التدفق النقدي الحر", "Net Cash Flow": "صافي التدفق النقدي",
  // Cash-flow explanations
  "Cost of sales excluding depreciation (a non-cash cost).": "تكلفة المبيعات دون الإهلاك (تكلفة غير نقدية).",
  "Operating and other expenses excluding depreciation & amortisation.": "المصروفات التشغيلية والأخرى دون الإهلاك والاستهلاك.",
  "Tax expense less the increase in tax owed (or plus the decrease).": "مصروف الضرائب ناقص الزيادة في الضرائب المستحقة (أو زائد النقص).",
  "Prior-period and one-off items booked in the P&L.": "بنود سنوات سابقة وبنود غير متكررة مسجلة في قائمة الدخل.",
  "Cash generated by trading, after tax and before interest. Interest is shown under financing.": "النقدية الناتجة عن النشاط بعد الضرائب وقبل الفوائد. تظهر الفوائد ضمن التمويل.",
  "Change in fixed assets plus the depreciation charged: what was spent on assets, net of disposals.": "التغير في الأصول الثابتة زائد الإهلاك المحمّل: ما أُنفق على الأصول بعد خصم المستبعد منها.",
  "Operating cash flow less investment: cash available to pay lenders and owners.": "التدفق النقدي التشغيلي ناقص الاستثمار: النقدية المتاحة لسداد المقرضين والملاك.",
  "Interest expense less interest income.": "مصروف الفوائد ناقص إيراد الفوائد.",
  "Capital paid in or withdrawn, and equity movements that did not come from this period's profit.": "رأس المال المدفوع أو المسحوب، وحركات حقوق الملكية التي لم تأتِ من ربح هذه الفترة.",
  "The balance sheet does not balance in one of the two months, so this amount cannot be explained.": "الميزانية غير متوازنة في أحد الشهرين، لذلك لا يمكن تفسير هذا المبلغ.",
  "Change in cash less change in borrowing: the cash the business made or used before new loans and repayments.": "التغير في النقدية ناقص التغير في الاقتراض: النقدية التي حققها النشاط أو استخدمها قبل القروض الجديدة والسداد.",
  // Metric groups and quick picks
  KPIs: "المؤشرات", "Profit & Loss": "قائمة الدخل", "Balance Sheet": "الميزانية", "Cash Flow": "التدفق النقدي", "Chart of Accounts": "دليل الحسابات",
  Income: "الدخل", "COS & Expense": "التكلفة والمصروفات", Profit: "الربح", Asset: "الأصول", Equity: "حقوق الملكية", "Working Capital": "رأس المال العامل",
  "Cash Conversion": "التحويل النقدي", Liquidity: "السيولة", "Cash Position": "المركز النقدي", "Profit vs Cash Flow": "الربح مقابل التدفق النقدي",
  // KPI categories and importance
  Profitability: "الربحية", Activity: "النشاط", Efficiency: "الكفاءة", "Asset Usage": "استخدام الأصول", Coverage: "التغطية", Gearing: "الرافعة المالية", Growth: "النمو",
  Critical: "حرج", High: "مرتفع", Medium: "متوسط", Low: "منخفض",
};

/** The Arabic for an engine or page name, or the name itself (English, or a name the company typed such as an account). */
export const tl = (s: string, lang: Lang): string => (lang === "ar" ? LINES_AR[s] ?? s : s);

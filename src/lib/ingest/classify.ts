import type { ClassKey } from "@/lib/engine";
import { normLabel } from "./parse";

// Order matters: specific before generic. Arabic terms included for Egyptian / GCC files. (Port of ingest.py rules.)
const PL_RULES: [string, RegExp][] = [
  ["interest_income", /interest (income|received|earned)|إيراد(ات)? فوائد|فوائد دائنة|interest on deposits/],
  ["interest_expenses", /interest (expense|paid|charge|on (loan|overdraft|borrowing))|finance (cost|charge|expense)|loan interest|bank interest (expense|paid)|فوائد مدينة|مصروفات تمويلية|مصاريف تمويلية|فوائد قروض/],
  ["tax_expenses", /(income|corporate|company|profit) tax|tax expense|provision for (income )?tax|ضريبة (الدخل|الشركات|أرباح)|ضرائب الدخل/],
  ["dividends", /dividend|distribution(s)? to|توزيعات/],
  ["adjustments", /adjustment|prior.?period|extraordinary|تسويات|فروقات سنوات/],
  ["other_income", /other (operating )?income|gain on|sundry income|miscellaneous income|fx gain|(foreign )?exchange gain|rental income|إيرادات (أخرى|اخرى|متنوعة)|ايرادات اخرى|أرباح بيع أصول/],
  ["other_expenses", /other (operating )?expense|loss on|fx loss|(foreign )?exchange (loss|difference)|write.?off|impairment|bad debt|مصروفات (أخرى|اخرى)|مصاريف اخرى|خسائر/],
  ["cos", /cost of (sales|goods|revenue|services|sold)|cogs|purchases?|direct (cost|material|labou?r)|raw material|freight.?in|inventory (adjustment|write)|production cost|stock (variation|valuation)|تكلفة (المبيعات|البضاعة|الخدمات)|مشتريات|مواد خام/],
  ["revenue", /sales|revenue|turnover|fees? (earned|income)|service (income|fees)|income from|subscription|مبيعات|إيراد(ات)?|ايرادات|دخل/],
];
const DEPRECIATION = /depreciation|amorti[sz]ation|إهلاك|اهلاك|استهلاك/;
export const CONTRA_REVENUE = /returns?|discounts? (allowed|given)|allowances?|rebates?|مردودات|خصم مسموح/i;
const VARIABLE_HINT = /commission|freight|shipping|delivery|packag|merchant|payment (gateway|processing)|transaction (fee|cost)|credit card (fee|charge)|bank (charge|fee)|fuel|royalt|raw material|materials?|purchases?|consumables?|cogs|sales (tax|incentive)|عمولة|شحن|توصيل|تغليف|رسوم بنكية|مشتريات|مواد/;
const FIXED_COS_HINT = /salar|wage|labou?r|payroll|rent|insurance|rental|رواتب|أجور|اجور|إيجار|ايجار/;
const BS_RULES: [ClassKey, RegExp][] = [
  ["tax_liab", /(vat|sales tax|income tax|corporate tax|payroll tax|withholding|gst|social insurance|tax(es)?)( \w+)? (payable|liabilit|due|control)|tax payable|tax received|tax paid|ضريبة القيمة المضافة|ضرائب (مستحقة|دائنة)|تأمينات اجتماعية|مصلحة الضرائب/],
  ["std", /overdraft|short.?term (loan|debt|borrowing|facilit)|current (portion|maturit)|credit card (payable|liab)|line of credit|(bank|loans?) payable|قروض قصيرة|سحب على المكشوف|بنوك دائنة|تسهيلات/],
  ["ltd", /long.?term (loan|debt|borrowing|liabilit)|mortgage|bonds? payable|term loan|notes payable.*long|قروض طويلة/],
  ["other_ncl", /deferred tax|lease liabilit|non.?current (liabilit|provision)|end of service|severance|مكافأة نهاية|التزامات طويلة/],
  ["other_cl", /accrued|accruals?|deferred (revenue|income)|unearned|customer (deposit|advance)|advances? from|provision|salaries payable|wages payable|due to|other (current )?liabilit|مستحق(ات)?|مصروفات مستحقة|إيرادات مقدمة|مخصص|دائنون متنوعون|أرصدة دائنة/],
  ["ap", /payables?|creditors?|suppliers?|vendors?|موردين|موردون|دائنون|أوراق دفع/],
  ["retained_earnings", /retained|accumulated (earnings|profit|loss)|undistributed|(current|this) (year|period).*(earnings|profit|income)|net (profit|income|loss) (for|ytd|of)|profit (for|of) the (year|period)|أرباح (محتجزة|مرحلة|العام|السنة)|الأرباح المرحلة|نتيجة العام/],
  ["other_equity", /capital|share (premium|capital)|equity|reserves?|owner|partner|paid.?in|treasury shares|رأس المال|احتياطي|جاري الشركاء|حقوق (الملكية|المساهمين)/],
  ["wip", /work.?in.?(progress|process)|\bwip\b|عقود تحت التنفيذ|إنتاج تحت التشغيل/],
  ["inventory", /inventor|stock|finished goods|merchandise|goods (on hand|for resale)|مخزون|بضاعة/],
  ["ar", /receivables?|debtors?|customers?|notes receivable|عملاء|مدينون|أوراق قبض/],
  ["other_ca", /prepaid|prepayment|advance|deposits? (paid|with)|other (current )?assets?|accrued income|due from|input vat|vat receivable|outstanding (receipts|payments)|مصروفات مقدمة|دفعات مقدمة|سلف|تأمينات لدى|أرصدة مدينة|عهد/],
  ["intangibles", /intangible|goodwill|patent|trademark|software|licen[cs]e|development cost|شهرة|برمجيات|علامة تجارية/],
  ["investments", /investments?|long.?term (deposit|receivable)|loans? to|استثمارات/],
  ["fixed_assets", /property|plant|equipment|furniture|vehicles?|machinery|buildings?|land|fixed assets?|accumulated depreciation|leasehold|computers?|fit.?out|أصول ثابتة|معدات|سيارات|مباني|أراضي|مجمع (إهلاك|اهلاك)|آلات|أثاث/],
  ["cash", /cash|bank|petty|treasury|safe|liquidity transfer|نقدية|نقدي|بنك|خزينة|حساب جاري لدى/],
];
const ALWAYS_PL_FIRST = /bank (charge|fee)s?|cash (discount|short)/;
const BS_HEADINGS = /asset|liabilit|equity|capital|shareholder|owner|الأصول|الاصول|الخصوم|الالتزامات|حقوق/;
const PL_HEADINGS = /income|revenue|sales|expense|cost|turnover|profit|الإيرادات|المصروفات|المصاريف|تكلفة|الدخل/;

export interface Classification { cls: ClassKey | null; conf: number; why: string }

/** Odoo/IFRS-style code prefixes (1 assets, 2 liabilities, 3 equity, 4 revenue, 5-8 expenses) as a weak statement hint. */
export function stmtFromCode(code: string): "PL" | "BS" | null {
  const d = code.trim()[0];
  if (!d) return null;
  if ("123".includes(d)) return "BS";
  if ("45678".includes(d)) return "PL";
  return null;
}

export function classify(label: string, section: string, stmt: "PL" | "BS" | null, mapping: Record<string, ClassKey> = {}, code = ""): Classification {
  const key = normLabel(label);
  if (mapping[key]) return { cls: mapping[key], conf: 1, why: "your mapping" };
  const low = label.toLowerCase();
  const sec = (section || "").toLowerCase();
  const dep = DEPRECIATION.test(low);
  const inCos = /cost of|cogs|direct|تكلفة/.test(sec);
  const inExp = /expense|overhead|مصروفات|مصاريف|opex|operating cost/.test(sec);
  const inRev = /revenue|sales|income|إيرادات|ايرادات/.test(sec) && !inCos && !inExp;
  let st = stmt;
  if (st === null) {
    if (BS_HEADINGS.test(sec)) st = "BS";
    else if (PL_HEADINGS.test(sec)) st = "PL";
    else st = stmtFromCode(code);
  }
  if (ALWAYS_PL_FIRST.test(low)) st = "PL";
  if (st === null || st === "PL") {
    if (dep && (st === "PL" || inCos || inExp || !/accumulated|مجمع/.test(low)))
      return { cls: inCos || (!section && code.trim()[0] === "5") ? "cos_depreciation" : "exp_depreciation", conf: 0.9, why: "depreciation" };
    for (const [cls, rx] of PL_RULES) {
      if (!rx.test(low)) continue;
      if (cls === "cos") return { cls: FIXED_COS_HINT.test(low) ? "cos_fixed" : "cos_variable", conf: 0.85, why: "cost of sales" };
      if (cls === "revenue" && (inCos || inExp || /commission|marketing|expense|salar|staff|\btax|cost|عمولة/.test(low))) continue;
      return { cls: cls as ClassKey, conf: 0.9, why: "keyword" };
    }
    if (st === null && /expenses?\b|مصروفات|مصاريف|overheads?/.test(low))
      return { cls: VARIABLE_HINT.test(low) ? "exp_variable" : "exp_fixed", conf: 0.5, why: "expense wording (check)" };
    if (st === "PL" && !inCos && !inExp && !inRev && !section) {
      const d = code.trim()[0];
      if (d === "4") return { cls: "revenue", conf: 0.55, why: "account code 4xxx (check)" };
      if (d === "5") return { cls: FIXED_COS_HINT.test(low) ? "cos_fixed" : "cos_variable", conf: 0.5, why: "account code 5xxx (check)" };
    }
    if (st === "PL" || inCos || inExp || inRev) {
      if (inRev) return { cls: "revenue", conf: 0.6, why: "section heading" };
      if (inCos) return { cls: FIXED_COS_HINT.test(low) ? "cos_fixed" : "cos_variable", conf: 0.6, why: "section heading" };
      return { cls: VARIABLE_HINT.test(low) ? "exp_variable" : "exp_fixed", conf: inExp ? 0.6 : 0.45, why: "default expense" };
    }
  }
  if (st === null || st === "BS") {
    for (const [cls, rx] of BS_RULES) if (rx.test(low)) return { cls, conf: st === "BS" ? 0.9 : 0.75, why: "keyword" };
    if (st === "BS") {
      if (/asset|الأصول/.test(sec)) return { cls: "other_ca", conf: 0.4, why: "section heading (check)" };
      if (/liabilit|الخصوم|الالتزامات/.test(sec)) return { cls: "other_cl", conf: 0.4, why: "section heading (check)" };
      if (/equity|capital|حقوق/.test(sec)) return { cls: "other_equity", conf: 0.4, why: "section heading (check)" };
      const c = code.trim()[0];
      if (c === "1") return { cls: "other_ca", conf: 0.35, why: "account code (check)" };
      if (c === "2") return { cls: "other_cl", conf: 0.35, why: "account code (check)" };
      if (c === "3") return { cls: "other_equity", conf: 0.35, why: "account code (check)" };
    }
  }
  return { cls: null, conf: 0, why: "no rule matched" };
}

/** Odoo 16+ account_type → class, refined by name keywords where Odoo's type is broad. */
export function classFromOdooType(type: string, name: string): Classification {
  const low = name.toLowerCase();
  const kw = (st: "PL" | "BS") => classify(name, "", st);
  switch (type) {
    case "asset_cash": return { cls: "cash", conf: 1, why: "Odoo type" };
    case "asset_receivable": return { cls: "ar", conf: 1, why: "Odoo type" };
    case "asset_prepayments": return { cls: "other_ca", conf: 1, why: "Odoo type" };
    case "asset_fixed": return { cls: "fixed_assets", conf: 1, why: "Odoo type" };
    case "asset_current": {
      if (/inventor|stock|merchandise|finished goods|goods in transit|مخزون|بضاعة/.test(low)) return { cls: "inventory", conf: 0.95, why: "Odoo type + name" };
      if (/work.?in.?(progress|process)|\bwip\b/.test(low)) return { cls: "wip", conf: 0.95, why: "Odoo type + name" };
      return { cls: "other_ca", conf: 0.9, why: "Odoo type" };
    }
    case "asset_non_current": {
      if (/intangible|goodwill|software|licen|patent|trademark|شهرة|برمجيات/.test(low)) return { cls: "intangibles", conf: 0.95, why: "Odoo type + name" };
      if (/property|plant|equipment|furniture|vehicle|machinery|building|أصول ثابتة|معدات/.test(low)) return { cls: "fixed_assets", conf: 0.9, why: "Odoo type + name" };
      return { cls: "investments", conf: 0.85, why: "Odoo type" };
    }
    case "liability_payable": return { cls: "ap", conf: 1, why: "Odoo type" };
    case "liability_credit_card": return { cls: "std", conf: 1, why: "Odoo type" };
    case "liability_current": {
      const k = kw("BS");
      if (k.cls === "tax_liab" || k.cls === "std") return { cls: k.cls, conf: 0.95, why: "Odoo type + name" };
      return { cls: "other_cl", conf: 0.9, why: "Odoo type" };
    }
    case "liability_non_current": {
      if (/loan|borrowing|mortgage|bond|debt|قرض|قروض/.test(low)) return { cls: "ltd", conf: 0.95, why: "Odoo type + name" };
      return { cls: "other_ncl", conf: 0.9, why: "Odoo type" };
    }
    case "equity": {
      if (/retained|undistributed|أرباح (محتجزة|مرحلة)/.test(low)) return { cls: "retained_earnings", conf: 0.95, why: "Odoo type + name" };
      return { cls: "other_equity", conf: 1, why: "Odoo type" };
    }
    case "equity_unaffected": return { cls: "retained_earnings", conf: 1, why: "Odoo type" };
    case "income": {
      const k = kw("PL");
      if (k.cls === "interest_income" || k.cls === "other_income") return { cls: k.cls, conf: 0.9, why: "Odoo type + name" };
      return { cls: "revenue", conf: 1, why: "Odoo type" };
    }
    case "income_other": {
      const k = kw("PL");
      return { cls: k.cls === "interest_income" ? "interest_income" : "other_income", conf: 0.95, why: "Odoo type" };
    }
    case "expense_direct_cost": return { cls: FIXED_COS_HINT.test(low) ? "cos_fixed" : DEPRECIATION.test(low) ? "cos_depreciation" : "cos_variable", conf: 0.95, why: "Odoo type" };
    case "expense_depreciation": return { cls: "exp_depreciation", conf: 1, why: "Odoo type" };
    case "expense": {
      const k = kw("PL");
      if (k.cls && ["interest_expenses", "tax_expenses", "other_expenses", "exp_depreciation", "cos_variable", "cos_fixed", "dividends", "adjustments"].includes(k.cls)) return { cls: k.cls, conf: 0.85, why: "Odoo type + name" };
      return { cls: VARIABLE_HINT.test(low) ? "exp_variable" : "exp_fixed", conf: 0.8, why: "Odoo type" };
    }
    case "off_balance": return { cls: null, conf: 0, why: "off-balance account (ignored)" };
    default: return classify(name, "", null);
  }
}

/** Odoo ≤15 account.account.type xmlids (account.data_account_type_*). */
export const ODOO15_TYPE_MAP: Record<string, string> = {
  data_account_type_liquidity: "asset_cash", data_account_type_receivable: "asset_receivable", data_account_type_current_assets: "asset_current",
  data_account_type_prepayments: "asset_prepayments", data_account_type_fixed_assets: "asset_fixed", data_account_type_non_current_assets: "asset_non_current",
  data_account_type_payable: "liability_payable", data_account_type_credit_card: "liability_credit_card", data_account_type_current_liabilities: "liability_current",
  data_account_type_non_current_liabilities: "liability_non_current", data_account_type_equity: "equity", data_unaffected_earnings: "equity_unaffected",
  data_account_type_revenue: "income", data_account_type_other_income: "income_other", data_account_type_direct_costs: "expense_direct_cost",
  data_account_type_depreciation: "expense_depreciation", data_account_type_expenses: "expense", data_account_off_sheet: "off_balance",
};

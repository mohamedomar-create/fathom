import { addMonths, BS_KEYS, PL_KEYS, type ClassKey } from "@/lib/engine";
import { CLASS_LABEL } from "@/lib/ingest/classes";

/**
 * iReport's own input templates: one layout per kind of data, read exactly (no guessing). Each sheet carries a marker
 * in its first cell so the importer recognises it, and every account row says which iReport class it belongs to.
 */
export type TemplateKind = "financials" | "sales";
export const TEMPLATE_KINDS: TemplateKind[] = ["financials", "sales"];

export const MARK_PREFIX = "iReport template";
export const MARK = {
  pl: `${MARK_PREFIX} · P&L by month · v1`,
  bs: `${MARK_PREFIX} · Balance sheet by month · v1`,
  sales: `${MARK_PREFIX} · Sales lines · v1`,
} as const;
export type SheetMark = keyof typeof MARK;

export const FIN_HEAD = ["Code", "Account", "iReport class"] as const;

/** The class name shown in the template's drop-down list. */
export const classChoice = (k: ClassKey) => CLASS_LABEL[k];
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const BY_CHOICE = new Map<string, ClassKey>([...PL_KEYS, ...BS_KEYS].flatMap((k) => [[squash(classChoice(k)), k], [squash(k), k]] as [string, ClassKey][]));
/** The class a template cell names (its drop-down text, or the class key), or null. */
export const classFromChoice = (v: string): ClassKey | null => BY_CHOICE.get(squash(v)) ?? null;

/** What goes in each class, in plain words (English and Arabic), for the template's Classes sheet. */
export const CLASS_HELP: Record<ClassKey, [string, string]> = {
  revenue: ["Sales of goods and services, net of VAT. Returns and discounts as negative amounts.", "المبيعات وإيرادات الخدمات بدون ضريبة القيمة المضافة؛ المرتجعات والخصومات بالسالب"],
  cos_variable: ["Cost of goods sold and other costs that rise with sales (materials, purchases).", "تكلفة البضاعة المباعة والتكاليف المتغيرة مع المبيعات"],
  cos_fixed: ["Fixed production or service costs (factory rent, direct staff salaries).", "تكاليف إنتاج ثابتة (إيجار المصنع، أجور العمالة المباشرة)"],
  cos_depreciation: ["Depreciation of production assets.", "إهلاك أصول الإنتاج"],
  exp_variable: ["Selling costs that rise with sales (commissions, delivery, card fees).", "مصروفات بيعية متغيرة (عمولات، شحن)"],
  exp_fixed: ["Operating expenses: salaries, rent, utilities, office, professional fees.", "المصروفات العمومية والإدارية: أجور، إيجار، مرافق"],
  exp_depreciation: ["Depreciation and amortisation of office and other assets.", "الإهلاك والاستهلاك"],
  other_income: ["Income outside normal trading (gains on sale of assets, rebates).", "إيرادات أخرى"],
  other_expenses: ["Expenses outside normal trading (losses, write-offs).", "مصروفات أخرى"],
  interest_income: ["Interest earned on deposits.", "فوائد دائنة"],
  interest_expenses: ["Interest and charges on loans and overdrafts.", "فوائد ومصروفات بنكية"],
  tax_expenses: ["Income tax charged in the month.", "ضريبة الدخل"],
  adjustments: ["One-off or prior-period adjustments booked in the P&L.", "تسويات سنوات سابقة"],
  dividends: ["Dividends declared to owners.", "توزيعات الأرباح"],
  cash: ["Cash in hand and bank balances.", "النقدية بالصندوق والبنوك"],
  ar: ["Customers (trade receivables), net of provisions.", "العملاء"],
  inventory: ["Stock of goods and materials.", "المخزون"],
  wip: ["Work in progress.", "أعمال تحت التنفيذ"],
  other_ca: ["Prepayments, advances to suppliers, other debtors, VAT receivable.", "مصروفات مقدمة وأرصدة مدينة أخرى"],
  fixed_assets: ["Fixed assets at cost, with accumulated depreciation as a negative row.", "الأصول الثابتة؛ مجمع الإهلاك بالسالب"],
  intangibles: ["Software, licences and other intangible assets.", "أصول غير ملموسة"],
  investments: ["Long-term investments and other non-current assets.", "استثمارات وأصول طويلة الأجل أخرى"],
  std: ["Overdrafts, short-term bank loans and the part of long-term loans due within 12 months.", "بنوك سحب على المكشوف وقروض قصيرة الأجل والجزء المتداول من القروض"],
  ap: ["Suppliers (trade payables).", "الموردين"],
  tax_liab: ["Income tax, VAT and withholding tax payable.", "الضرائب المستحقة"],
  other_cl: ["Accruals, customer advances and other creditors.", "مصروفات مستحقة ودفعات مقدمة من العملاء وأرصدة دائنة أخرى"],
  ltd: ["Bank loans due after 12 months.", "قروض طويلة الأجل"],
  other_ncl: ["Other long-term liabilities (end-of-service provisions, leases).", "التزامات طويلة الأجل أخرى"],
  retained_earnings: ["Retained earnings, including this year's profit to date.", "الأرباح المرحلة شاملة أرباح العام حتى تاريخه"],
  other_equity: ["Share capital, reserves and owners' current accounts.", "رأس المال والاحتياطيات وجاري الشركاء"],
};

/** Accounts listed in the financial template to start from; the person renames, deletes or adds rows. */
export const PL_ROWS: [string, ClassKey][] = [
  ["Sales revenue", "revenue"], ["Sales returns and discounts", "revenue"], ["Cost of goods sold", "cos_variable"], ["Direct labour", "cos_fixed"],
  ["Salaries and wages", "exp_fixed"], ["Rent", "exp_fixed"], ["Utilities and communication", "exp_fixed"], ["Marketing and advertising", "exp_variable"],
  ["Sales commissions", "exp_variable"], ["Shipping and delivery", "exp_variable"], ["Depreciation", "exp_depreciation"], ["Other income", "other_income"],
  ["Other expenses", "other_expenses"], ["Interest income", "interest_income"], ["Bank interest and charges", "interest_expenses"], ["Income tax", "tax_expenses"],
];
export const BS_ROWS: [string, ClassKey][] = [
  ["Cash in hand and banks", "cash"], ["Customers", "ar"], ["Inventory", "inventory"], ["Prepayments and other debtors", "other_ca"],
  ["Fixed assets at cost", "fixed_assets"], ["Accumulated depreciation (negative)", "fixed_assets"], ["Intangible assets", "intangibles"],
  ["Suppliers", "ap"], ["Overdraft and short-term loans", "std"], ["Current portion of long-term loans", "std"], ["Taxes payable", "tax_liab"],
  ["Accruals and other creditors", "other_cl"], ["Long-term loans", "ltd"], ["Share capital", "other_equity"], ["Retained earnings incl. profit to date", "retained_earnings"],
];

export interface SalesCol { key: "date" | "doc" | "customer" | "product" | "category" | "salesperson" | "qty" | "amount" | "cost"; head: string; required: boolean; help: string }
export const SALES_COLS: SalesCol[] = [
  { key: "date", head: "Invoice date", required: true, help: "The invoice date, e.g. 15/01/2026 (day first) or a date cell." },
  { key: "doc", head: "Invoice number", required: false, help: "The invoice or credit note number, e.g. INV/2026/0001." },
  { key: "customer", head: "Customer", required: true, help: "The customer's name, written the same way every time." },
  { key: "product", head: "Product", required: true, help: "The product or service sold." },
  { key: "category", head: "Product category", required: false, help: "The product's group or brand (used for business lines)." },
  { key: "salesperson", head: "Salesperson", required: false, help: "Who made the sale." },
  { key: "qty", head: "Quantity", required: false, help: "Units sold; negative for returns." },
  { key: "amount", head: "Net sales amount (excl. VAT)", required: true, help: "The line's amount before VAT; negative for credit notes and returns." },
  { key: "cost", head: "Cost of goods sold", required: false, help: "What the goods sold cost, for the margin." },
];

/** The months of the financial year starting in `fyStart` of `year`, and the month before it (the opening balance). */
export function templateMonths(year: number, fyStart: number) {
  const first = `${year}-${String(fyStart).padStart(2, "0")}`;
  return { opening: addMonths(first, -1), months: Array.from({ length: 12 }, (_, i) => addMonths(first, i)) };
}

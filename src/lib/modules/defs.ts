// The modules the intake routes tables to. Sales and expenses share their column matching with the readers that save them
// (salesFieldOf, expenseFieldOf), so a column means the same thing everywhere. Open items, payments and purchasing are
// list modules described here in full.
import { arRx } from "@/lib/ingest/parse";
import { salesFieldOf, VENDOR_HDR } from "@/lib/ingest/sales";
import { expenseFieldOf } from "@/lib/ingest/expenses";
import type { ModuleDef, ModuleField } from "./types";

const f = (key: string, en: string, ar: string, type: ModuleField["type"], heading: string, headings: RegExp): ModuleField => ({ key, label: { en, ar }, type, heading, headings });

const CUSTOMER_HDR = arRx(/^(customer|customers|client|customer name|العميل|العملاء|اسم العميل)$/i);
const PARTNER = "partner|partner_id|contact|الشريك|جهة الاتصال";
const DUE = arRx(/^(due date|due|date due|date_maturity|invoice_date_due|maturity date|payment due|تاريخ الاستحقاق|الاستحقاق|تاريخ الإستحقاق)$/i);
const OPEN = arRx(/^(amount due|balance due|due amount|open amount|amount open|outstanding|outstanding amount|residual|amount residual|amount_residual|amount_residual_signed|balance|remaining|remaining amount|open balance|unpaid|unpaid amount|المبلغ المتبقي|المتبقي|الرصيد|الرصيد المستحق|المبلغ المستحق|غير مدفوع)$/i);
const ITEM_DOC = arRx(/^(invoice|invoice number|invoice no\.?|invoice #|bill|bill number|bill no\.?|bill reference|number|reference|document|ref|name|رقم الفاتورة|الفاتورة|رقم المستند|المرجع|رقم)$/i);
const ITEM_DATE = arRx(/^(date|invoice date|bill date|document date|invoice_date|التاريخ|تاريخ الفاتورة|تاريخ المستند|تاريخ)$/i);
const ITEM_TOTAL = arRx(/^(amount|total|invoice amount|bill amount|amount total|amount_total|amount_total_signed|total amount|original amount|المبلغ|الإجمالي|الاجمالي|قيمة الفاتورة|المبلغ الأصلي)$/i);
const CURRENCY = arRx(/^(currency|currency_id|العملة)$/i);

const sales: ModuleDef = {
  key: "sales",
  name: { en: "Sales", ar: "المبيعات" },
  owns: { en: "Sales invoice lines (products, customers, quantities)", ar: "بنود فواتير المبيعات (الأصناف والعملاء والكميات)" },
  sector: "sales",
  storage: "sales_lines",
  fields: [
    f("date", "Date", "التاريخ", "date", "Date", /^$/), f("period", "Month", "الشهر", "month", "Month", /^$/),
    f("doc", "Invoice number", "رقم الفاتورة", "code", "Number", /^$/), f("customer", "Customer", "العميل", "text", "Customer", /^$/),
    f("product", "Product", "الصنف", "text", "Product", /^$/), f("category", "Product category", "فئة المنتج", "text", "Product Category", /^$/),
    f("salesperson", "Salesperson", "المندوب", "text", "Salesperson", /^$/), f("qty", "Quantity", "الكمية", "qty", "Quantity", /^$/),
    f("untaxed", "Untaxed amount", "المبلغ قبل الضريبة", "money", "Untaxed Amount", /^$/), f("total", "Total", "الإجمالي", "money", "Total", /^$/),
    f("cost", "Cost", "التكلفة", "money", "Cost", /^$/), f("margin", "Margin", "هامش الربح", "money", "Margin", /^$/),
  ],
  required: [["date", "period"], ["untaxed", "total"]],
  amount: "untaxed",
  amountAlt: ["total"],
  signature: [["product", "qty", "category"]],
  excludes: VENDOR_HDR,
  sheetWords: arRx(/(sales|sale|invoices?|revenue|مبيعات|المبيعات|فواتير|الفواتير|إيرادات)/i),
  docSide: "customer",
  fieldOf: (h) => salesFieldOf(h),
  ties: [{ key: "sales_revenue", label: { en: "Sales = revenue in the books", ar: "المبيعات = الإيرادات في الدفاتر" }, classes: ["revenue"], basis: "movement", flip: true }],
  party: "customer", doc: "doc", date: "date",
};

const expenses: ModuleDef = {
  key: "expenses",
  name: { en: "Expenses", ar: "المصروفات" },
  owns: { en: "Bills and expense lines (suppliers, accounts, types)", ar: "فواتير الموردين وبنود المصروفات" },
  sector: "expenses",
  storage: "expense_lines",
  fields: [
    f("date", "Date", "التاريخ", "date", "Date", /^$/), f("period", "Month", "الشهر", "month", "Month", /^$/),
    f("doc", "Bill number", "رقم الفاتورة", "code", "Number", /^$/), f("supplier", "Vendor", "المورد", "text", "Vendor", /^$/),
    f("account", "Account", "الحساب", "text", "Account", /^$/), f("category", "Category", "التصنيف", "text", "Category", /^$/),
    f("label", "Description", "البيان", "text", "Label", /^$/),
    f("untaxed", "Untaxed amount", "المبلغ قبل الضريبة", "money", "Untaxed Amount", /^$/), f("total", "Total", "الإجمالي", "money", "Total", /^$/),
  ],
  required: [["date", "period"], ["untaxed", "total"]],
  amount: "untaxed",
  amountAlt: ["total"],
  signature: [["supplier", "account", "category"]],
  excludes: CUSTOMER_HDR,
  sheetWords: arRx(/(expenses?|bills?|costs?|purchases?|vendors?|suppliers?|مصروفات|المصروفات|مصاريف|فواتير الموردين|تكاليف)/i),
  docSide: "supplier",
  fieldOf: (h) => expenseFieldOf(h),
  ties: [{ key: "expenses_costs", label: { en: "Expenses = costs in the books", ar: "المصروفات = التكاليف في الدفاتر" }, classes: ["cos_variable", "cos_fixed", "exp_variable", "exp_fixed", "other_expenses"], basis: "movement" }],
  party: "supplier", doc: "doc", date: "date",
};

const openItems = (side: "ar" | "ap"): ModuleDef => {
  const ar = side === "ar";
  return {
    key: ar ? "ar_open" : "ap_open",
    name: ar ? { en: "Receivables (open invoices)", ar: "المدينون (الفواتير المفتوحة)" } : { en: "Payables (open bills)", ar: "الدائنون (الفواتير المفتوحة)" },
    owns: ar ? { en: "What customers still owe, invoice by invoice", ar: "ما يستحق على العملاء فاتورةً فاتورة" } : { en: "What the company still owes suppliers, bill by bill", ar: "ما يستحق للموردين فاتورةً فاتورة" },
    sector: "payments",
    storage: "aged",
    fields: [
      f("party", ar ? "Customer" : "Vendor", ar ? "العميل" : "المورد", "text", ar ? "Customer" : "Vendor",
        ar ? arRx(new RegExp(`^(customer|customers|client|customer name|debtor|${PARTNER}|العميل|العملاء|اسم العميل|المدين)$`, "i")) : arRx(new RegExp(`^(vendor|vendors|supplier|suppliers|vendor name|supplier name|creditor|${PARTNER}|المورد|الموردين|اسم المورد|المورّد|الدائن)$`, "i"))),
      f("doc", ar ? "Invoice number" : "Bill number", "رقم الفاتورة", "code", ar ? "Invoice" : "Bill", ITEM_DOC),
      f("date", ar ? "Invoice date" : "Bill date", "تاريخ الفاتورة", "date", ar ? "Invoice Date" : "Bill Date", ITEM_DATE),
      f("due", "Due date", "تاريخ الاستحقاق", "date", "Due Date", DUE),
      f("total", ar ? "Invoice amount" : "Bill amount", "قيمة الفاتورة", "money", "Amount", ITEM_TOTAL),
      f("open", "Amount due", "المبلغ المتبقي", "money", "Amount Due", OPEN),
      f("currency", "Currency", "العملة", "code", "Currency", CURRENCY),
    ],
    required: [["party"], ["open"]],
    amount: "open",
    signature: [["due", "date"]],
    excludes: ar ? VENDOR_HDR : CUSTOMER_HDR,
    sheetWords: ar ? arRx(/(\bar\b|receivables?|debtors?|ageing|aging|customer balances?|statement of account|المدينين|المدينون|العملاء|ذمم مدينة|مديونية)/i) : arRx(/(\bap\b|payables?|creditors?|supplier balances?|vendors?|suppliers?|الدائنين|الدائنون|الموردين|ذمم دائنة)/i),
    docSide: ar ? "customer" : "supplier",
    ties: [{ key: ar ? "ar_control" : "ap_control", label: ar ? { en: "Receivables = the customers' control account", ar: "المدينون = حساب العملاء" } : { en: "Payables = the suppliers' control account", ar: "الدائنون = حساب الموردين" }, classes: [ar ? "ar" : "ap"], basis: "balance", flip: !ar }],
    party: "party", doc: "doc", date: "date",
  };
};

const payments: ModuleDef = {
  key: "payments",
  name: { en: "Payments in and out", ar: "المدفوعات والمقبوضات" },
  owns: { en: "Customer collections and supplier payments", ar: "تحصيلات العملاء ومدفوعات الموردين" },
  sector: "payments",
  storage: "payments",
  fields: [
    f("date", "Payment date", "تاريخ الدفع", "date", "Date", arRx(/^(date|payment date|التاريخ|تاريخ الدفع|تاريخ السداد)$/i)),
    f("number", "Payment number", "رقم الدفعة", "code", "Number", arRx(/^(number|payment number|reference|receipt no\.?|الرقم|رقم الدفعة|رقم الإيصال|المرجع)$/i)),
    f("journal", "Journal", "اليومية", "text", "Journal", arRx(/^(journal|journal_id|bank|cash account|اليومية|دفتر اليومية|البنك|الخزينة)$/i)),
    f("method", "Payment method", "طريقة الدفع", "text", "Payment Method", arRx(/^(payment method|method|payment_method_line_id|طريقة الدفع|وسيلة الدفع)$/i)),
    f("partner", "Customer or vendor", "العميل أو المورد", "text", "Partner", arRx(/^(partner|customer\/vendor|customer|vendor|partner_id|payee|paid by|الشريك|العميل|المورد|المستفيد)$/i)),
    f("amount", "Amount", "المبلغ", "money", "Amount", arRx(/^(amount|amount signed|amount_signed|amount company currency signed|paid|received|المبلغ|المبلغ المدفوع|المبلغ المحصل)$/i)),
    f("state", "Status", "الحالة", "text", "Status", arRx(/^(status|state|الحالة)$/i)),
  ],
  required: [["date"], ["amount"]],
  amount: "amount",
  signature: [["journal", "method"]],
  sheetWords: arRx(/(payments?|receipts?|collections?|مدفوعات|المدفوعات|مقبوضات|تحصيلات|سداد)/i),
  party: "partner", doc: "number", date: "date",
};

const purchasing: ModuleDef = {
  key: "purchasing",
  name: { en: "Purchasing", ar: "المشتريات" },
  owns: { en: "Purchase orders: ordered, received and billed", ar: "أوامر الشراء: المطلوب والمستلم والمفوتر" },
  sector: "expenses",
  storage: "generic",
  fields: [
    f("po", "Purchase order", "أمر الشراء", "code", "PO Number", arRx(/^(order reference|purchase order|po|po number|po no\.?|order|order number|رقم أمر الشراء|أمر الشراء|رقم الطلب)$/i)),
    f("supplier", "Vendor", "المورد", "text", "Vendor", arRx(/^(vendor|supplier|partner|partner_id|المورد|اسم المورد)$/i)),
    f("date", "Order date", "تاريخ الطلب", "date", "PO Date", arRx(/^(order date|date order|date_order|po date|date|confirmation date|تاريخ الطلب|التاريخ|تاريخ التأكيد)$/i)),
    f("product", "Product", "الصنف", "text", "Product", arRx(/^(product|product_id|item|الصنف|المنتج)$/i)),
    f("ordered", "Ordered quantity", "الكمية المطلوبة", "qty", "Ordered Quantity", arRx(/^(ordered quantity|quantity|qty ordered|product_qty|الكمية المطلوبة|الكمية)$/i)),
    f("received", "Received quantity", "الكمية المستلمة", "qty", "Received Quantity", arRx(/^(received quantity|qty received|qty_received|received|الكمية المستلمة|المستلم)$/i)),
    f("billed", "Billed quantity", "الكمية المفوترة", "qty", "Billed Quantity", arRx(/^(billed quantity|qty billed|qty_invoiced|billed|الكمية المفوترة|المفوتر)$/i)),
    f("amount", "Untaxed amount", "المبلغ قبل الضريبة", "money", "Untaxed Amount", arRx(/^(untaxed amount|subtotal|price subtotal|price_subtotal|amount untaxed|amount_untaxed|total|amount|المبلغ قبل الضريبة|الإجمالي|المبلغ)$/i)),
  ],
  required: [["po"], ["amount"]],
  amount: "amount",
  signature: [["ordered", "received", "billed"]],
  sheetWords: arRx(/(purchas|\bpo\b|orders?|مشتريات|المشتريات|أوامر الشراء)/i),
  docSide: "supplier",
  party: "supplier", doc: "po", date: "date",
};

export const DEFS: ModuleDef[] = [sales, expenses, openItems("ar"), openItems("ap"), payments, purchasing];

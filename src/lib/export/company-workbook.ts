import { ECONOMY_KEY, FORECAST_KEY, HIGHLIGHTS_KEY, RESERVED_KEYS } from "@/lib/company/config-keys";
import { accountMarkKey, highlightsOf, markAt } from "@/lib/engine/statement-rows";

/**
 * Everything stored for one company, as plain sheets (arrays of rows) and then an .xlsx file.
 * Secrets never enter: the caller passes no Odoo API key and no share tokens, and the builder has no field for them.
 */

type Cell = string | number | boolean | null;
export interface Sheet { name: string; rows: Cell[][] }

export interface CompanyExport {
  exportedAt: string;
  orgName: string;
  company: { name: string; currency: string; fy_start_month: number; tax_rate: number; industry: string | null; source: string; data_version: number; last_synced_at: string | null; ai_context: unknown; kpi_config: unknown; notes: unknown };
  accounts: { code: string; name: string; statement: string; class: string; amounts: Record<string, number> }[];
  imports: { created_at: string; action: string; kind: string; filename: string | null; status: string; data_version: number | null }[];
  commentary: { period_key: string; section: string; source: string; updated_at: string; body: string }[];
  reports: { title: string; period_type: string; period_end: string; status: string; shared: boolean; expires_at: string | null; published_at: string | null; created_at: string }[];
  odoo: { url: string; db: string; login: string; odoo_company_name: string | null; months_history: number; status: string; last_sync_at: string | null } | null;
  expenses?: { day: string | null; period: string; doc: string; series: string; supplier: string; account: string; cls: string | null; category: string; label: string; amount: number; source: string }[];
  /** Every budget version with its lines and products. */
  budgets?: { name: string; fy: string; kind: string; status: string; lines: { key: string; cls: string; label: string | null; month: string; amount: number }[]; products: { product: string; category: string | null; month: string; units: number; price: number; unit_cost: number | null }[] }[];
  sales?: { day: string | null; period: string; doc: string; series: string; customer: string; product: string; category: string; salesperson: string; qty: number | null; amount: number; cost: number | null; source: string }[];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const cell = (v: unknown): Cell => (v === undefined ? null : typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null ? v : JSON.stringify(v));

/** lang: sheet names and headings in Arabic for an Arabic page; the figures, codes and names stay as stored. */
export function companySheets(d: CompanyExport, lang: "en" | "ar" = "en"): Sheet[] {
  const w = (en: string, ar: string) => (lang === "ar" ? ar : en);
  const c = d.company;
  const acctKeys = new Set(d.accounts.map((a) => accountMarkKey(a)));
  const company: Cell[][] = [
    [w("Company", "الشركة"), c.name], [w("Organisation", "المؤسسة"), d.orgName], [w("Currency", "العملة"), c.currency], [w("Financial year starts", "بداية السنة المالية"), (lang === "ar" ? MONTHS_AR : MONTHS)[c.fy_start_month - 1] ?? c.fy_start_month],
    [w("Corporate tax rate", "نسبة ضريبة الدخل"), c.tax_rate], [w("Industry", "النشاط"), c.industry], [w("Source", "المصدر"), c.source], [w("Data version", "إصدار البيانات"), c.data_version],
    [w("Last updated", "آخر تحديث"), day(c.last_synced_at)], [w("Exported", "تاريخ التصدير"), d.exportedAt],
  ];
  const kpis = Object.entries(obj(c.kpi_config)).filter(([k]) => !RESERVED_KEYS.includes(k));
  const econ = Object.entries(obj(obj(c.kpi_config)[ECONOMY_KEY])).filter(([, v]) => v !== null && v !== undefined);
  if (econ.length) { company.push([], [w("Economic assumptions", "الافتراضات الاقتصادية")]); for (const [k, v] of econ) company.push([k, cell(v)]); }
  const fc = Object.entries(obj(obj(c.kpi_config)[FORECAST_KEY])).filter(([, v]) => v !== null && v !== undefined);
  if (fc.length) { company.push([], [w("Forecast drivers", "محركات التوقعات")]); for (const [k, v] of fc) company.push([k, cell(v)]); }
  if (kpis.length) {
    company.push([], [w("KPI", "المؤشر"), w("Active", "مفعّل"), w("Importance", "الأهمية"), w("Target", "المستهدف"), w("Alert on", "التنبيه مفعّل"), w("Alert threshold", "حد التنبيه")]);
    for (const [k, v] of kpis) { const o = obj(v); company.push([k, cell(o.active), cell(o.importance), cell(o.target), cell(o.alert_active), cell(o.alert_threshold)]); }
  }
  const ctx = Object.entries(obj(c.ai_context)).filter(([, v]) => v !== "" && v != null);
  if (ctx.length) { company.push([], [w("AI business context", "سياق النشاط للذكاء الاصطناعي")]); for (const [k, v] of ctx) company.push([k, cell(v)]); }
  // Highlighted statements: when a line is flagged, and every colour mark editors set on statement lines.
  const hl = highlightsOf(obj(c.kpi_config));
  const lineMarks = Object.entries(hl.lines).filter(([k]) => !k.startsWith("#") && !k.startsWith("@") && !acctKeys.has(k));
  if (HIGHLIGHTS_KEY in obj(c.kpi_config)) {
    company.push([], [w("Highlights", "التمييز")], [w("Flag a move of at least (%)", "تمييز تغيّر لا يقل عن (%)"), hl.pct], [w("And at least", "وبما لا يقل عن"), hl.amount]);
    if (lineMarks.length) { company.push([w("Line", "البند"), w("Mark", "اللون"), w("Note", "ملاحظة")]); for (const [k, m] of lineMarks) company.push([k, m.color, m.note ?? null]); }
  }
  const notes = Object.entries(obj(c.notes));
  if (notes.length) { company.push([], [w("Notes", "ملاحظات")]); for (const [k, v] of notes) company.push([k, cell(v)]); }

  const periods = [...new Set(d.accounts.flatMap((a) => Object.keys(a.amounts)))].sort();
  const markOf = (a: { code: string | null; name: string }) => markAt(hl.lines, accountMarkKey(a));
  const anyAcctMark = d.accounts.some((a) => markOf(a));
  const accounts: Cell[][] = [[w("Code", "الكود"), w("Account", "الحساب"), w("Statement", "القائمة"), w("Class", "التصنيف"), ...(anyAcctMark ? [w("Mark", "اللون"), w("Mark note", "ملاحظة التمييز")] : []), ...periods],
    ...d.accounts.map((a) => [a.code, a.name, a.statement, a.class, ...(anyAcctMark ? [markOf(a)?.color ?? null, markOf(a)?.note ?? null] : []), ...periods.map((p) => a.amounts[p] ?? null)])];

  const sheets: Sheet[] = [
    { name: w("Company", "الشركة"), rows: company },
    { name: w("Accounts", "الحسابات"), rows: accounts },
    { name: w("Imports", "عمليات الاستيراد"), rows: [[w("Date", "التاريخ"), w("Action", "الإجراء"), w("Kind", "النوع"), w("File", "الملف"), w("Status", "الحالة"), w("Data version", "إصدار البيانات")], ...d.imports.map((i) => [i.created_at, i.action, i.kind, i.filename, i.status, i.data_version])] },
    { name: w("Commentary", "التعليقات"), rows: [[w("Period", "الفترة"), w("Section", "القسم"), w("Written by", "كتبه"), w("Updated", "آخر تحديث"), w("Text", "النص")], ...d.commentary.map((m) => [m.period_key, m.section, m.source === "ai" ? w("AI", "الذكاء الاصطناعي") : w("User", "المستخدم"), m.updated_at, m.body])] },
    { name: w("Reports", "التقارير"), rows: [[w("Title", "العنوان"), w("Period type", "نوع الفترة"), w("Period end", "نهاية الفترة"), w("Status", "الحالة"), w("Shared link", "رابط مشاركة"), w("Link expires", "انتهاء الرابط"), w("Published", "تاريخ النشر"), w("Created", "تاريخ الإنشاء")], ...d.reports.map((r) => [r.title, r.period_type, r.period_end, r.status, r.shared ? w("yes", "نعم") : w("no", "لا"), day(r.expires_at), day(r.published_at), day(r.created_at)])] },
  ];
  if (d.expenses?.length) {
    sheets.push({ name: w("Expense lines", "بنود المصروفات"), rows: [[w("Date", "التاريخ"), w("Month", "الشهر"), w("Bill", "الفاتورة"), w("Series", "السلسلة"), w("Supplier", "المورد"), w("Account", "الحساب"), w("Class", "التصنيف"), w("Category", "الفئة"), w("Description", "البيان"), w("Amount", "المبلغ"), w("Source", "المصدر")],
      ...d.expenses.map((l) => [l.day, l.period, l.doc, l.series, l.supplier, l.account, l.cls, l.category, l.label, Number(l.amount), l.source === "file" ? w("Expenses file", "ملف المصروفات") : w("General Ledger", "دفتر الأستاذ العام")])] });
  }
  if (d.sales?.length) {
    sheets.push({ name: w("Sales lines", "بنود المبيعات"), rows: [[w("Date", "التاريخ"), w("Month", "الشهر"), w("Invoice", "الفاتورة"), w("Series", "السلسلة"), w("Customer", "العميل"), w("Product", "المنتج"), w("Category", "الفئة"), w("Salesperson", "مندوب المبيعات"), w("Quantity", "الكمية"), w("Amount", "المبلغ"), w("Cost", "التكلفة"), w("Source", "المصدر")],
      ...d.sales.map((l) => [l.day, l.period, l.doc, l.series, l.customer, l.product, l.category, l.salesperson, l.qty === null ? null : Number(l.qty), Number(l.amount), l.cost === null ? null : Number(l.cost), l.source === "file" ? w("Sales file", "ملف المبيعات") : w("General Ledger", "دفتر الأستاذ العام")])] });
  }
  if (d.budgets?.some((b) => b.lines.length)) {
    sheets.push({ name: w("Budget lines", "بنود الموازنة"), rows: [[w("Version", "الإصدار"), w("Financial year", "السنة المالية"), w("Status", "الحالة"), w("Key", "المفتاح"), w("Account", "الحساب"), w("Class", "التصنيف"), w("Month", "الشهر"), w("Amount", "المبلغ")],
      ...d.budgets.flatMap((b) => b.lines.map((l) => [b.name, b.fy, b.status, l.key, l.label, l.cls, l.month, Number(l.amount)]))] });
  }
  if (d.budgets?.some((b) => b.products.length)) {
    sheets.push({ name: w("Budget products", "منتجات الموازنة"), rows: [[w("Version", "الإصدار"), w("Financial year", "السنة المالية"), w("Product", "المنتج"), w("Category", "الفئة"), w("Month", "الشهر"), w("Units", "الكمية"), w("Price", "السعر"), w("Unit cost", "تكلفة الوحدة")],
      ...d.budgets.flatMap((b) => b.products.map((p) => [b.name, b.fy, p.product, p.category, p.month, Number(p.units), Number(p.price), p.unit_cost === null ? null : Number(p.unit_cost)]))] });
  }
  if (d.odoo) {
    const o = d.odoo;
    sheets.push({ name: w("Odoo connection", "الاتصال بأودو"), rows: [[w("Address", "العنوان"), o.url], [w("Database", "قاعدة البيانات"), o.db], [w("Login", "اسم الدخول"), o.login], [w("Odoo company", "الشركة في أودو"), o.odoo_company_name], [w("Months of history", "أشهر التاريخ"), o.months_history], [w("Status", "الحالة"), o.status], [w("Last sync", "آخر مزامنة"), o.last_sync_at], [w("API key", "مفتاح API"), w("not exported", "لا يُصدَّر")]] });
  }
  return sheets;
}

export async function toXlsx(sheets: Sheet[]): Promise<Uint8Array> {
  const XLSX = await import("@e965/xlsx");
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows); // strings stay text cells; nothing is written as a formula
    ws["!cols"] = (s.rows[0] ?? []).map((_, i) => ({ wch: i < 2 ? 28 : 14 }));
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  return XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true }) as Uint8Array;
}

/** "Nile Trading & Co." → "nile-trading-co" for a download file name (Arabic letters are kept). */
export function slug(name: string) {
  return name.normalize("NFKC").replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 60) || "company";
}

/** A Content-Disposition value that survives non-ASCII names. */
export function attachment(filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

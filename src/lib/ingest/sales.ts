import { arRx, arToLatin, cleanNum, detectDateOrder, normAr, parseDay, parsePeriod, type Cell, type DateOrder } from "./parse";
import { headerPeriod, str, type Grid, type LedgerEntry } from "./extract";
import { applyFixes, badAmount, cellRef, shown, type CellError, type Fixes, type Marks } from "./trace";
import { checkSalesTemplate, templateMarkOf } from "./template";
import { isBillDoc, seriesOf } from "@/lib/engine/series";

/**
 * Sales lines for the Sales and Business Lines sectors, from two places:
 *  - the revenue lines of an Odoo General Ledger (every invoice line already carries date, invoice, customer and product);
 *  - a sales export: Odoo's Sales / Invoice Analysis as a list, or a pivot of products or customers by month.
 * Amounts are net of tax in the company currency; credit notes are negative.
 */
export interface SalesLine {
  day: string | null;
  period: string;
  doc: string;
  /** Invoice series: "INV", "INV2", "RINV" (refunds)… from the invoice number. */
  series: string;
  customer: string;
  product: string;
  category: string;
  salesperson: string;
  qty: number | null;
  amount: number;
  cost: number | null;
  /** The sales order behind the invoice line (live sync, or a Source Document column). */
  saleOrder?: string;
  /** Who the goods were for, when Odoo records it apart from the billed customer: the order's customer, the contact the
   * invoice was addressed to, or its delivery address (mapMethod says which). Needed when a buying agency is billed. */
  endUser?: string;
  mapMethod?: "order" | "contact" | "shipping";
  /** A line with no end-user link: its description, where an agency order number may be read ("( PRO 501 / 22 ) …"). */
  note?: string;
  /** Where the line was read (sales files only): the sheet and its row as uploaded. Never saved. */
  src?: { sheet: string; row: number };
}

export const NO_CATEGORY = "No category";
export const NO_CUSTOMER = "No customer";
export const JOURNAL_ENTRIES = "Revenue journal entries (no invoice)";

/** Document series ("INV", "BILL"…) are shared with the expenses reader and the engine. */
export { isBillDoc, seriesOf };

/**
 * An Odoo invoice line label: "[Trudell] Aero Chamber Plus, Medium Mask" or "[Device] Airtech AE-8\n01/04/2026 13:00 to 02/04/2026".
 * The bracket is the product's internal reference, which many companies use for the brand or category.
 */
/** firstLine: an invoice line's label (a ledger entry), where the lines under the product's name are the sale description. */
export function splitLabel(label: string, firstLine = false): { category: string; product: string } {
  const first = (firstLine ? label.split(/\r?\n/)[0] : label).replace(/\s+/g, " ").trim();
  const m = first.match(/^\[([^\]]+)\]\s*(.*)$/);
  const product = (m ? m[2] : first).replace(/\s+/g, " ").trim();
  return { category: m ? m[1].trim() : NO_CATEGORY, product: product || "No description" };
}

/** Revenue-account move lines of a General Ledger as sales lines. Lines must be mapped (the class decides what is revenue). */
export function salesFromLedger(lines: { cls: string | null; excluded: boolean; entries?: LedgerEntry[] }[]): SalesLine[] {
  const out: SalesLine[] = [];
  for (const l of lines) {
    if (l.excluded || l.cls !== "revenue" || !l.entries) continue;
    for (const e of l.entries) {
      if (!e.amount) continue;
      // A journal entry on a revenue account (no invoice behind it) keeps sales equal to revenue, under one plain name.
      const journal = !e.label || e.label === e.ref || e.label === `Entry ${e.ref}` || /^MISC\b/i.test(seriesOf(e.ref));
      const { category, product } = journal && !/^\[/.test(e.label) ? { category: NO_CATEGORY, product: JOURNAL_ENTRIES } : splitLabel(e.label, true);
      out.push({ day: e.day, period: e.period, doc: e.ref, series: seriesOf(e.ref), customer: e.partner || NO_CUSTOMER, product, category, salesperson: "", qty: null, amount: Math.round(-e.amount * 100) / 100, cost: null });
    }
  }
  return out;
}

// ---------------------------------------------------------------- sales exports

export type SalesField = "date" | "doc" | "customer" | "product" | "category" | "salesperson" | "qty" | "untaxed" | "total" | "cost" | "margin" | "period";
const FIELD_RX: [SalesField, RegExp][] = [
  ["untaxed", arRx(/^(untaxed( total| amount)?( signed)?|amount untaxed|total untaxed|tax excluded|subtotal|sub ?total|price subtotal|net (sales|amount|revenue|total)|net sales amount|sales value|revenue|net|المبلغ قبل الضريبة|الصافي|صافي المبيعات|الإجمالي قبل الضريبة|قيمة المبيعات|المبيعات|الإيراد)$/i)],
  ["total", arRx(/^(total|amount|amount total|total amount|grand total|value|الإجمالي|الاجمالي|القيمة|المبلغ|إجمالي)$/i)],
  ["date", arRx(/^(date|invoice date|order date|accounting date|التاريخ|تاريخ الفاتورة|تاريخ الطلب|تاريخ)$/i)],
  ["period", arRx(/^(month|period|الشهر|الفترة)$/i)],
  ["doc", arRx(/^(number|invoice( number| no\.?| #)?|reference|order( reference| no\.?)?|document|رقم الفاتورة|الفاتورة|رقم المستند|المرجع|رقم)$/i)],
  ["customer", arRx(/^(customer|partner|client|invoice partner( display name)?|العميل|اسم العميل|الشريك)$/i)],
  ["product", arRx(/^(product|product name|item|article|description|الصنف|المنتج|اسم الصنف|البيان)$/i)],
  ["category", arRx(/^(product category|category|brand|product line|family|الفئة|التصنيف|المجموعة|فئة المنتج|العلامة التجارية)$/i)],
  ["salesperson", arRx(/^(salesperson|sales ?person|sales ?rep|user|seller|sales team|المندوب|مندوب المبيعات|البائع|فريق المبيعات)$/i)],
  ["qty", arRx(/^(quantity|qty|qty (invoiced|delivered|ordered)|units|الكمية|العدد)$/i)],
  ["cost", arRx(/^(cost|total cost|cost of sales|cost of goods sold|cogs|التكلفة|تكلفة المبيعات)$/i)],
  ["margin", arRx(/^(margin|gross margin|profit|الربح|هامش الربح|مجمل الربح)$/i)],
];
/** A heading's field; a required-mark "*" and "(excl. VAT)" are ignored, as in iReport's sales template. */
const fieldOf = (h: string): SalesField | null => {
  const t = normAr(h.replace(/\s*\*\s*$/, "").replace(/\s*\((excl\.?|excluding|before|without) (vat|tax)\)\s*$/i, "").replace(/\s+/g, " ").trim());
  return FIELD_RX.find(([, rx]) => rx.test(t))?.[0] ?? null;
};
const TOTAL_ROW = arRx(/^(total|grand total|sum|الإجمالي|الاجمالي|المجموع|إجمالي)\b/i);
const MEASURE = arRx(/^(untaxed total|untaxed amount|total untaxed|price subtotal|subtotal|quantity|qty|margin|المبلغ قبل الضريبة|الصافي|الكمية)$/i);
const ACCOUNT_HDR = arRx(/^(code|account|account code|account name|الحساب|اسم الحساب|كود الحساب|رقم الحساب)$/i);
/** Headings that make a list a purchases / vendor bills file (the expenses reader), never sales. */
export const VENDOR_HDR = arRx(/^(vendor|vendors|supplier|suppliers|vendor name|supplier name|vendor reference|bill date|bill number|bill reference|المورد|الموردين|اسم المورد|المورّد|تاريخ فاتورة المورد|فاتورة المورد)$/i);
/** A list whose document numbers are mostly vendor bills: purchases, even under a generic "Partner" heading. */
export function mostlyBills(rows: Cell[][], col: number) {
  if (col < 0) return false;
  let bills = 0, n = 0;
  for (const r of rows) { const d = str(r?.[col]); if (!d) continue; n++; if (isBillDoc(d)) bills++; if (n >= 200) break; }
  return n > 0 && bills / n >= 0.5;
}

export interface SalesLayout {
  sheet: string;
  kind: "list" | "pivot";
  headerRow: number;
  /** Column index → the field it was read as (list), or the month it holds (pivot). */
  columns: { col: number; header: string; field: SalesField | null; period?: string }[];
  /** Pivot: what the rows are (product, category or customer) and what the figures are. */
  rowsAre?: "product" | "category" | "customer";
  measure?: "untaxed" | "total" | "qty";
  dateOrder?: DateOrder;
  /** Only a tax-inclusive total was found. */
  taxIncluded: boolean;
  /** Credit notes whose positive quantity was turned negative, to match their negative amount. */
  qtyFlipped?: number;
  lines: number;
  total: number;
  /** Rows kept (empty rows removed) → row in the sheet as uploaded; headerRow indexes the kept rows. */
  rowNo: number[];
  /** Where each row of the sheet as uploaded went, and the cells that cannot be read (each blocks saving until fixed). */
  trace: Marks;
  errors: CellError[];
}
/** The person's corrections: what a column holds (by column index), retyped cells and rows left out (sheet as uploaded). */
export interface SalesOverride extends Fixes { cols?: Partial<Record<number, SalesField | null>> }

/** Reads a sales export, or returns null when the sheet is not one (an accounting report goes to the accounting reader). */
export function readSalesGrid(g: Grid, ov: SalesOverride = {}): { lines: SalesLine[]; layout: SalesLayout } | null {
  const fixed = applyFixes(g.rows, ov);
  const rowNo: number[] = [];
  fixed.forEach((r, i) => { if (r && r.some((c) => str(c) !== "")) rowNo.push(i); });
  const rows = rowNo.map((i) => fixed[i]);
  const cols = ov.cols ?? {};
  for (let r = 0; r < Math.min(rows.length, 25); r++) {
    const heads = rows[r].map((v) => str(v));
    if (heads.some((h) => ACCOUNT_HDR.test(normAr(h)))) return null;
    // Purchases (vendor bills, the expenses template) are read by the expenses reader.
    if (templateMarkOf(g) === "expenses" || heads.some((h) => VENDOR_HDR.test(normAr(h.replace(/\s*\*\s*$/, ""))))) return null;
    const fields = heads.map((h, c) => (c in cols ? cols[c] ?? null : fieldOf(h)));
    if (mostlyBills(rows.slice(r + 1), fields.indexOf("doc"))) return null;
    const has = (f: SalesField) => fields.includes(f);
    const months = heads.map((h, c) => ({ c, p: headerPeriod(h) })).filter((x) => x.p && x.p.months === 1);
    const ctx: Ctx = { g, rows, rowNo, r, heads, marks: [], errors: [] };
    // A list: an amount column and something to group by (customer or product), with a date or month on each row.
    if ((has("untaxed") || has("total")) && (has("customer") || has("product")) && (has("date") || has("period"))) return finish(ctx, ov, readList(ctx, fields));
    // A pivot: a product, category or customer column and two or more month columns.
    const dim = fields.findIndex((f) => f === "product" || f === "category" || f === "customer");
    // Without a Product / Category / Customer heading, only Odoo's pivot layout counts: an empty corner cell and a measure
    // row ("Untaxed Total", "Quantity") under the months. A P&L with month columns has neither.
    const measureRow = (rows[r + 1] ?? []).some((v) => MEASURE.test(normAr(str(v))));
    if (months.length >= 2 && (dim >= 0 || (months[0].c > 0 && !heads[0] && measureRow))) return finish(ctx, ov, readPivot(ctx, dim >= 0 ? dim : 0, (dim >= 0 ? fields[dim] : "product") as "product" | "category" | "customer", months.map((m) => ({ c: m.c, p: m.p!.p })), [...rows.slice(0, r), rows[r + 1] ?? []].map((x) => x.map(str).join(" ")).join(" ")));
  }
  return null;
}

/** What a sales reader works with: the kept rows, the heading row, and the row marks and errors it records (kept-row indexes). */
interface Ctx { g: Grid; rows: Cell[][]; rowNo: number[]; r: number; heads: string[]; marks: Marks; errors: { row: number; col: number; text: string; message: string }[] }

/** Marks and errors moved onto the sheet as uploaded; an iReport sales template is also checked cell by cell. */
function finish(ctx: Ctx, ov: SalesOverride, out: { lines: SalesLine[]; layout: Omit<SalesLayout, "rowNo" | "trace" | "errors"> } | null) {
  if (!out) return null;
  const { g, rowNo } = ctx;
  const trace: Marks = [];
  rowNo.forEach((orig, i) => { trace[orig] = ctx.marks[i] ?? (i === ctx.r ? { role: "header" } : i < ctx.r ? { role: "title" } : { role: "unused", note: "nothing to read on this row" }); });
  for (const r of ov.skipRows ?? []) if (r >= 0 && r < g.rows.length) trace[r] = { role: "skipped", note: "left out by you" };
  const errors: CellError[] = ctx.errors.map((e) => { const row = rowNo[e.row] ?? e.row; return { sheet: g.name, row, col: e.col, text: e.text, message: `${cellRef(row, e.col, g.origin)}: ${e.message}` }; });
  if (templateMarkOf(g) === "sales") {
    for (const p of checkSalesTemplate({ ...g, rows: applyFixes(g.rows, ov) })) {
      if (p.r === undefined || errors.some((e) => e.row === p.r && e.col === p.c)) continue;
      errors.push({ sheet: g.name, row: p.r, col: p.c ?? 0, text: p.text ?? "", message: `${cellRef(p.r, p.c, g.origin)}: ${p.message}` });
      trace[p.r] = { role: "error", note: p.message };
    }
  }
  return { lines: out.lines, layout: { ...out.layout, rowNo, trace, errors } };
}

function readList(ctx: Ctx, fields: (SalesField | null)[]) {
  const { g, rows, r, heads } = ctx;
  const sheet = g.name;
  const col = (f: SalesField) => fields.indexOf(f);
  const cAmt = col("untaxed") >= 0 ? col("untaxed") : col("total");
  const cDate = col("date"), cPer = col("period");
  const order = detectDateOrder(rows.slice(r + 1).map((x) => x[cDate])).order ?? "dmy";
  const lines: SalesLine[] = [];
  let qtyFlipped = 0;
  const text = (x: Cell[], f: SalesField) => (col(f) >= 0 ? str(x[col(f)]).replace(/\s+/g, " ") : "");
  const err = (i: number, c: number, message: string) => { ctx.errors.push({ row: i, col: c, text: shown(rows[i][c]), message }); ctx.marks[i] = { role: "error", note: message }; };
  for (let i = r + 1; i < rows.length; i++) {
    const x = rows[i];
    const first = str(x[0]);
    if (TOTAL_ROW.test(normAr(first)) && !text(x, "customer") && !text(x, "product")) { ctx.marks[i] = { role: "total", note: "iReport works out totals itself" }; continue; }
    const amount = cleanNum(x[cAmt]);
    if (amount === null) {
      if (badAmount(x[cAmt], amount)) err(i, cAmt, `"${shown(x[cAmt])}" is not a number`);
      else ctx.marks[i] = { role: "unused", note: `no amount in "${heads[cAmt]}"` };
      continue;
    }
    // A line with no amount still moved goods when it has a quantity (free of charge with a sale): kept for its units.
    const free = amount === 0 && col("qty") >= 0 && !!cleanNum(x[col("qty")]);
    if (amount === 0 && !free) { ctx.marks[i] = { role: "unused", note: "the amount is 0" }; continue; }
    const day = cDate >= 0 ? parseDay(x[cDate], order) : null;
    const period = day?.slice(0, 7) ?? (cDate >= 0 ? parsePeriod(x[cDate], order) : null) ?? (cPer >= 0 ? parsePeriod(x[cPer]) : null);
    if (!period) {
      const c = cDate >= 0 ? cDate : cPer;
      err(i, c, str(x[c]) ? `"${shown(x[c])}" is not a date` : `no ${cDate >= 0 ? "invoice date" : "month"} on this line`);
      continue;
    }
    for (const f of ["qty", "cost", "margin"] as const) if (col(f) >= 0 && badAmount(x[col(f)], cleanNum(x[col(f)]))) err(i, col(f), `"${shown(x[col(f)])}" is not a number`);
    const cost = col("cost") >= 0 ? cleanNum(x[col("cost")]) : col("margin") >= 0 && cleanNum(x[col("margin")]) !== null ? amount - cleanNum(x[col("margin")])! : null;
    const doc = text(x, "doc");
    const rawProduct = text(x, "product");
    const lab = rawProduct ? splitLabel(rawProduct) : { product: "No description", category: NO_CATEGORY };
    if (!ctx.marks[i]) ctx.marks[i] = { role: "entry" };
    // A credit note takes goods back: Odoo can print its quantity positive beside a negative amount.
    let qty = col("qty") >= 0 ? cleanNum(x[col("qty")]) : null;
    if (qty !== null && qty > 0 && amount < 0) { qty = -qty; qtyFlipped++; }
    lines.push({
      day, period, doc, series: seriesOf(doc), customer: text(x, "customer") || NO_CUSTOMER,
      product: lab.product, category: text(x, "category") || lab.category, salesperson: text(x, "salesperson"),
      qty, amount: Math.round(amount * 100) / 100, cost: cost === null ? null : Math.round(cost * 100) / 100,
      src: { sheet, row: ctx.rowNo[i] },
    });
  }
  if (!lines.length && !ctx.errors.length) return null;
  const layout = {
    sheet, kind: "list" as const, headerRow: r, columns: heads.map((h, c) => ({ col: c, header: h, field: fields[c] })), dateOrder: cDate >= 0 ? order : undefined,
    taxIncluded: col("untaxed") < 0, lines: lines.length, total: lines.reduce((s, l) => s + l.amount, 0), ...(qtyFlipped ? { qtyFlipped } : {}),
  };
  return { lines, layout };
}

function readPivot(ctx: Ctx, cDim: number, rowsAre: "product" | "category" | "customer", months: { c: number; p: string }[], title: string) {
  const { g, rows, r, heads } = ctx;
  const sheet = g.name;
  const t = normAr(arToLatin(title + " " + heads.join(" ")).toLowerCase());
  const measure: "untaxed" | "total" | "qty" = /quantit|qty|الكمية/.test(t) ? "qty" : /untaxed|subtotal|net|قبل الضريبة|الصافي/.test(t) ? "untaxed" : "total";
  if (measure === "qty") return null; // quantities alone carry no value
  const lines: SalesLine[] = [];
  for (let i = r + 1; i < rows.length; i++) {
    const x = rows[i];
    const name = str(x[cDim]).replace(/\s+/g, " ");
    if (!name) { ctx.marks[i] = { role: i === r + 1 ? "header" : "unused", note: i === r + 1 ? undefined : "no name in the first column" }; continue; }
    if (TOTAL_ROW.test(normAr(name))) { ctx.marks[i] = { role: "total", note: "iReport works out totals itself" }; continue; }
    let n = 0;
    for (const m of months) {
      const amount = cleanNum(x[m.c]);
      if (badAmount(x[m.c], amount)) { ctx.errors.push({ row: i, col: m.c, text: shown(x[m.c]), message: `"${shown(x[m.c])}" is not a number` }); ctx.marks[i] = { role: "error", note: "an amount cannot be read" }; continue; }
      if (!amount) continue;
      const lab = rowsAre === "product" ? splitLabel(name) : null;
      n++;
      lines.push({
        day: null, period: m.p, doc: "", series: "", customer: rowsAre === "customer" ? name : NO_CUSTOMER,
        product: lab ? lab.product : rowsAre === "category" ? name : "No description", category: lab ? lab.category : rowsAre === "category" ? name : NO_CATEGORY,
        salesperson: "", qty: null, amount: Math.round(amount * 100) / 100, cost: null, src: { sheet, row: ctx.rowNo[i] },
      });
    }
    if (!ctx.marks[i]) ctx.marks[i] = n ? { role: "entry", note: `${n} month${n > 1 ? "s" : ""}` } : { role: "unused", note: "no amounts" };
  }
  if (!lines.length && !ctx.errors.length) return null;
  const layout = {
    sheet, kind: "pivot" as const, headerRow: r, rowsAre, measure, taxIncluded: measure === "total",
    columns: heads.map((h, c) => ({ col: c, header: h, field: c === cDim ? rowsAre : null, period: months.find((m) => m.c === c)?.p })),
    lines: lines.length, total: lines.reduce((s, l) => s + l.amount, 0),
  };
  return { lines, layout };
}

/** Months a set of sales lines covers. */
export const salesPeriods = (lines: SalesLine[]) => [...new Set(lines.map((l) => l.period))].sort();

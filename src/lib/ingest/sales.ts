import { arRx, arToLatin, cleanNum, detectDateOrder, normAr, parseDay, parsePeriod, type Cell, type DateOrder } from "./parse";
import { headerPeriod, str, type Grid, type LedgerEntry } from "./extract";

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
}

export const NO_CATEGORY = "No category";
export const NO_CUSTOMER = "No customer";
export const JOURNAL_ENTRIES = "Revenue journal entries (no invoice)";

/** "INV/2026/0044" → "INV"; "RINV/2026/0003" → "RINV". */
export const seriesOf = (doc: string) => (doc.match(/^([A-Za-z][A-Za-z0-9]*)[/\-]/)?.[1] ?? "").toUpperCase();

/**
 * An Odoo invoice line label: "[Trudell] Aero Chamber Plus, Medium Mask" or "[Device] Airtech AE-8\n01/04/2026 13:00 to 02/04/2026".
 * The bracket is the product's internal reference, which many companies use for the brand or category.
 */
export function splitLabel(label: string): { category: string; product: string } {
  const first = label.split(/\r?\n/)[0].trim();
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
      const { category, product } = journal && !/^\[/.test(e.label) ? { category: NO_CATEGORY, product: JOURNAL_ENTRIES } : splitLabel(e.label);
      out.push({ day: e.day, period: e.period, doc: e.ref, series: seriesOf(e.ref), customer: e.partner || NO_CUSTOMER, product, category, salesperson: "", qty: null, amount: Math.round(-e.amount * 100) / 100, cost: null });
    }
  }
  return out;
}

// ---------------------------------------------------------------- sales exports

export type SalesField = "date" | "doc" | "customer" | "product" | "category" | "salesperson" | "qty" | "untaxed" | "total" | "cost" | "margin" | "period";
const FIELD_RX: [SalesField, RegExp][] = [
  ["untaxed", arRx(/^(untaxed( total| amount)?|amount untaxed|subtotal|sub ?total|price subtotal|net (sales|amount|revenue|total)|sales value|revenue|net|المبلغ قبل الضريبة|الصافي|صافي المبيعات|الإجمالي قبل الضريبة|قيمة المبيعات|المبيعات|الإيراد)$/i)],
  ["total", arRx(/^(total|amount|amount total|total amount|grand total|value|الإجمالي|الاجمالي|القيمة|المبلغ|إجمالي)$/i)],
  ["date", arRx(/^(date|invoice date|order date|accounting date|التاريخ|تاريخ الفاتورة|تاريخ الطلب|تاريخ)$/i)],
  ["period", arRx(/^(month|period|الشهر|الفترة)$/i)],
  ["doc", arRx(/^(number|invoice( number| no\.?| #)?|reference|order( reference| no\.?)?|document|رقم الفاتورة|الفاتورة|رقم المستند|المرجع|رقم)$/i)],
  ["customer", arRx(/^(customer|partner|client|invoice partner( display name)?|العميل|اسم العميل|الشريك)$/i)],
  ["product", arRx(/^(product|product name|item|article|description|الصنف|المنتج|اسم الصنف|البيان)$/i)],
  ["category", arRx(/^(product category|category|brand|product line|family|الفئة|التصنيف|المجموعة|فئة المنتج|العلامة التجارية)$/i)],
  ["salesperson", arRx(/^(salesperson|sales ?person|sales ?rep|user|seller|sales team|المندوب|مندوب المبيعات|البائع|فريق المبيعات)$/i)],
  ["qty", arRx(/^(quantity|qty|qty (invoiced|delivered|ordered)|units|الكمية|العدد)$/i)],
  ["cost", arRx(/^(cost|total cost|cost of sales|cogs|التكلفة|تكلفة المبيعات)$/i)],
  ["margin", arRx(/^(margin|gross margin|profit|الربح|هامش الربح|مجمل الربح)$/i)],
];
const fieldOf = (h: string): SalesField | null => FIELD_RX.find(([, rx]) => rx.test(normAr(h.replace(/\s+/g, " ").trim())))?.[0] ?? null;
const TOTAL_ROW = arRx(/^(total|grand total|sum|الإجمالي|الاجمالي|المجموع|إجمالي)\b/i);
const ACCOUNT_HDR = arRx(/^(code|account|account code|account name|الحساب|اسم الحساب|كود الحساب|رقم الحساب)$/i);

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
  lines: number;
  total: number;
}
export type SalesOverride = Partial<Record<number, SalesField | null>>;

/** Reads a sales export, or returns null when the sheet is not one (an accounting report goes to the accounting reader). */
export function readSalesGrid(g: Grid, ov: SalesOverride = {}): { lines: SalesLine[]; layout: SalesLayout } | null {
  const rows = g.rows.filter((r) => r && r.some((c) => str(c) !== ""));
  for (let r = 0; r < Math.min(rows.length, 25); r++) {
    const heads = rows[r].map((v) => str(v));
    if (heads.some((h) => ACCOUNT_HDR.test(normAr(h)))) return null;
    const fields = heads.map((h, c) => (c in ov ? ov[c] ?? null : fieldOf(h)));
    const has = (f: SalesField) => fields.includes(f);
    const months = heads.map((h, c) => ({ c, p: headerPeriod(h) })).filter((x) => x.p && x.p.months === 1);
    // A list: an amount column and something to group by (customer or product), with a date or month on each row.
    if ((has("untaxed") || has("total")) && (has("customer") || has("product")) && (has("date") || has("period"))) return readList(g.name, rows, r, heads, fields);
    // A pivot: a product, category or customer column and two or more month columns.
    const dim = fields.findIndex((f) => f === "product" || f === "category" || f === "customer");
    if (months.length >= 2 && (dim >= 0 || (months[0].c > 0 && !heads[0]))) return readPivot(g.name, rows, r, heads, dim >= 0 ? dim : 0, (dim >= 0 ? fields[dim] : "product") as "product" | "category" | "customer", months.map((m) => ({ c: m.c, p: m.p!.p })), [...rows.slice(0, r), rows[r + 1] ?? []].map((x) => x.map(str).join(" ")).join(" "));
  }
  return null;
}

function readList(sheet: string, rows: Cell[][], r: number, heads: string[], fields: (SalesField | null)[]) {
  const col = (f: SalesField) => fields.indexOf(f);
  const cAmt = col("untaxed") >= 0 ? col("untaxed") : col("total");
  const cDate = col("date"), cPer = col("period");
  const body = rows.slice(r + 1);
  const order = detectDateOrder(body.map((x) => x[cDate])).order ?? "dmy";
  const lines: SalesLine[] = [];
  const text = (x: Cell[], f: SalesField) => (col(f) >= 0 ? str(x[col(f)]).replace(/\s+/g, " ") : "");
  for (const x of body) {
    const first = str(x[0]);
    if (TOTAL_ROW.test(normAr(first)) && !text(x, "customer") && !text(x, "product")) continue;
    const amount = cleanNum(x[cAmt]);
    if (amount === null || amount === 0) continue;
    const day = cDate >= 0 ? parseDay(x[cDate], order) : null;
    const period = day?.slice(0, 7) ?? (cDate >= 0 ? parsePeriod(x[cDate], order) : null) ?? (cPer >= 0 ? parsePeriod(x[cPer]) : null);
    if (!period) continue;
    const cost = col("cost") >= 0 ? cleanNum(x[col("cost")]) : col("margin") >= 0 && cleanNum(x[col("margin")]) !== null ? amount - cleanNum(x[col("margin")])! : null;
    const doc = text(x, "doc");
    const rawProduct = text(x, "product");
    const lab = rawProduct ? splitLabel(rawProduct) : { product: "No description", category: NO_CATEGORY };
    lines.push({
      day, period, doc, series: seriesOf(doc), customer: text(x, "customer") || NO_CUSTOMER,
      product: lab.product, category: text(x, "category") || lab.category, salesperson: text(x, "salesperson"),
      qty: col("qty") >= 0 ? cleanNum(x[col("qty")]) : null, amount: Math.round(amount * 100) / 100, cost: cost === null ? null : Math.round(cost * 100) / 100,
    });
  }
  if (!lines.length) return null;
  const layout: SalesLayout = {
    sheet, kind: "list", headerRow: r, columns: heads.map((h, c) => ({ col: c, header: h, field: fields[c] })), dateOrder: cDate >= 0 ? order : undefined,
    taxIncluded: col("untaxed") < 0, lines: lines.length, total: lines.reduce((s, l) => s + l.amount, 0),
  };
  return { lines, layout };
}

function readPivot(sheet: string, rows: Cell[][], r: number, heads: string[], cDim: number, rowsAre: "product" | "category" | "customer", months: { c: number; p: string }[], title: string) {
  const t = normAr(arToLatin(title + " " + heads.join(" ")).toLowerCase());
  const measure: "untaxed" | "total" | "qty" = /quantit|qty|الكمية/.test(t) ? "qty" : /untaxed|subtotal|net|قبل الضريبة|الصافي/.test(t) ? "untaxed" : "total";
  if (measure === "qty") return null; // quantities alone carry no value
  const lines: SalesLine[] = [];
  for (const x of rows.slice(r + 1)) {
    const name = str(x[cDim]).replace(/\s+/g, " ");
    if (!name || TOTAL_ROW.test(normAr(name))) continue;
    for (const m of months) {
      const amount = cleanNum(x[m.c]);
      if (!amount) continue;
      const lab = rowsAre === "product" ? splitLabel(name) : null;
      lines.push({
        day: null, period: m.p, doc: "", series: "", customer: rowsAre === "customer" ? name : NO_CUSTOMER,
        product: lab ? lab.product : rowsAre === "category" ? name : "No description", category: lab ? lab.category : rowsAre === "category" ? name : NO_CATEGORY,
        salesperson: "", qty: null, amount: Math.round(amount * 100) / 100, cost: null,
      });
    }
  }
  if (!lines.length) return null;
  const layout: SalesLayout = {
    sheet, kind: "pivot", headerRow: r, rowsAre, measure, taxIncluded: measure === "total",
    columns: heads.map((h, c) => ({ col: c, header: h, field: c === cDim ? rowsAre : null, period: months.find((m) => m.c === c)?.p })),
    lines: lines.length, total: lines.reduce((s, l) => s + l.amount, 0),
  };
  return { lines, layout };
}

/** Months a set of sales lines covers. */
export const salesPeriods = (lines: SalesLine[]) => [...new Set(lines.map((l) => l.period))].sort();

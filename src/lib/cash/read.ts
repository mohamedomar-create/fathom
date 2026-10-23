import { arRx, arToLatin, cleanNum, detectDateOrder, normAr, parseDay, type Cell, type DateOrder } from "@/lib/ingest/parse";
import type { Grid } from "@/lib/ingest/extract";
import { PAID_ON_RX, PAID_RX, parsePaid } from "@/lib/ingest/simple-cols";

/**
 * The cash book's own reader: a small company's sheet of money in and money out. Three layouts, told apart by their
 * headings (English or Arabic): In and Out columns; one Amount with a Type column; or an Amount on a sheet whose name
 * says Sales or Expenses. Nothing from the ledger readers: no accounts, sheet roles, checks or Odoo layouts.
 */
export type CashField = "date" | "in" | "out" | "amount" | "type" | "category" | "party" | "note" | "paid" | "paidOn";
export interface CashEntry {
  day: string; direction: "in" | "out"; amount: number; category: string; party: string; note: string;
  paid: boolean | null; paidOn: string | null;
  src: { sheet: string; row: number };
}
export interface CashSkip { sheet: string; row: number; reason: string }
export type CashLayout = "inout" | "typed" | "amount";
export interface CashSheet {
  sheet: string; layout: CashLayout;
  /** Each column's heading and what it was read as (null: not used). */
  columns: { index: number; heading: string; field: CashField | null }[];
  /** An amount-only sheet whose name does not say sales or expenses: the person says which. */
  needsKind: boolean;
  kind: "in" | "out" | null;
  entries: CashEntry[]; skipped: CashSkip[];
}

// Order matters: a payment date is checked before a date, a money column before a plain amount.
const RX: [CashField, RegExp][] = [
  ["paidOn", PAID_ON_RX],
  ["paid", PAID_RX],
  ["date", arRx(/^(date|day|transaction date|التاريخ|تاريخ|اليوم|تاريخ العملية)$/i)],
  ["in", arRx(/^(in|money in|cash in|income|incoming|receipts?|received|takings|sales|revenue|debit in|وارد|الوارد|داخل|مقبوضات|المقبوضات|إيراد|ايراد|إيرادات|ايرادات|الإيرادات|مبيعات|المبيعات|دخل|الدخل)$/i)],
  ["out", arRx(/^(out|money out|cash out|outgoing|expenses?|spent|spending|payments?|paid out|costs?|منصرف|المنصرف|صادر|الصادر|خارج|مدفوعات|المدفوعات|مصروف|مصروفات|المصروفات|مصاريف|المصاريف)$/i)],
  ["amount", arRx(/^(amount|value|total|sum|net amount|price|المبلغ|القيمة|الإجمالي|الاجمالي|المجموع|الصافي)$/i)],
  ["type", arRx(/^(type|kind|in ?\/ ?out|direction|movement|النوع|نوع الحركة|الحركة|نوع العملية)$/i)],
  ["category", arRx(/^(category|item|items|product|expense type|account|البند|الفئة|الصنف|التصنيف|نوع المصروف|المنتج)$/i)],
  ["party", arRx(/^(customer|client|supplier|vendor|party|who|name|paid to|received from|العميل|المورد|الاسم|الجهة|المستفيد)$/i)],
  ["note", arRx(/^(description|details|note|notes|memo|remarks|البيان|الوصف|التفاصيل|ملاحظات|ملاحظة)$/i)],
];
const IN_WORD = arRx(/^(in|money in|cash in|sale|sales|income|receipt|received|revenue|دخل|وارد|داخل|بيع|مبيعات|إيراد|ايراد|مقبوض|تحصيل)$/i);
const OUT_WORD = arRx(/^(out|money out|cash out|expense|expenses|cost|payment|purchase|spent|مصروف|مصروفات|صرف|منصرف|خارج|صادر|شراء|مشتريات|دفع)$/i);
const SALES_SHEET = arRx(/(sales|income|revenue|takings|money in|مبيعات|المبيعات|ايرادات|إيرادات|الإيرادات|وارد|دخل)/i);
const EXPENSE_SHEET = arRx(/(expense|expenses|costs|spending|money out|مصروفات|المصروفات|مصاريف|منصرف|صادر)/i);
const TOTAL = arRx(/^(total|grand total|sum|totals|الإجمالي|الاجمالي|المجموع|إجمالي|اجمالي)\b/i);

/** The key a heading is remembered by (case, spaces, a trailing "*" and Arabic spellings ignored). */
export const cashHeadingKey = (h: string) => normAr(h.replace(/\s*\*\s*$/, "").replace(/\s+/g, " ").trim()).toLowerCase();
const text = (c: Cell) => (c === null || c === undefined ? "" : c instanceof Date ? "" : String(c).replace(/\s+/g, " ").trim());
const fieldOf = (h: string): CashField | null => { const t = normAr(h.replace(/\s*\*\s*$/, "").replace(/\s+/g, " ").trim()); return RX.find(([, rx]) => rx.test(t))?.[0] ?? null; };

/** A date cell: a real date, an Excel day number, or day/month text in the column's order. */
function dayOf(c: Cell, order: DateOrder): string | null {
  if (typeof c === "number" && c > 20000 && c < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(c) * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  if (typeof c === "string") return parseDay(arToLatin(c.trim()), order);
  return parseDay(c, order);
}

function headerRow(rows: Cell[][], map: Record<string, CashField | "">): { row: number; fields: (CashField | null)[] } | null {
  for (let r = 0; r < Math.min(rows.length, 25); r++) {
    const fields = (rows[r] ?? []).map((c) => { const h = text(c); if (!h) return null; const k = cashHeadingKey(h); return k in map ? (map[k] || null) as CashField | null : fieldOf(h); });
    const has = (f: CashField) => fields.includes(f);
    if (has("date") && (has("in") || has("out") || has("amount"))) return { row: r, fields };
  }
  return null;
}

/**
 * One sheet. Null when it has no row of headings with a date and an amount (it is not a cash sheet). `kind` says
 * whether an amount-only sheet is money in or out; `map` holds the person's column choices by heading.
 */
export function readCashGrid(g: Grid, opts: { kind?: "in" | "out"; map?: Record<string, CashField | ""> } = {}): CashSheet | null {
  const rows = g.rows ?? [];
  const h = headerRow(rows, opts.map ?? {});
  if (!h) return null;
  // Each field from the first column that holds it.
  const col = (f: CashField) => h.fields.indexOf(f);
  const layout: CashLayout = col("in") >= 0 || col("out") >= 0 ? "inout" : col("type") >= 0 ? "typed" : "amount";
  const named = SALES_SHEET.test(g.name) ? "in" : EXPENSE_SHEET.test(g.name) ? "out" : null;
  const kind = layout === "amount" ? opts.kind ?? named : null;
  const columns = (rows[h.row] ?? []).map((c, index) => ({ index, heading: text(c), field: h.fields[index] ?? null }));
  const sheet: CashSheet = { sheet: g.name, layout, columns, needsKind: layout === "amount" && !kind, kind, entries: [], skipped: [] };
  if (sheet.needsKind) return sheet;
  const body = rows.slice(h.row + 1);
  const order = detectDateOrder(body.map((r) => r?.[col("date")])).order ?? "dmy";
  const payOrder = col("paidOn") >= 0 ? detectDateOrder(body.map((r) => r?.[col("paidOn")])).order ?? order : order;
  const get = (r: Cell[], f: CashField) => (col(f) >= 0 ? r[col(f)] : null);
  body.forEach((r, i) => {
    const rowNo = h.row + i + 2;
    const cells = r ?? [];
    if (cells.every((c) => text(c) === "" && !(c instanceof Date) && typeof c !== "number")) return;
    const skip = (reason: string) => sheet.skipped.push({ sheet: g.name, row: rowNo, reason });
    const first = cells.map(text).find(Boolean) ?? "";
    if (TOTAL.test(first)) return skip("total row");
    const rawDay = get(cells, "date");
    if (rawDay === null || rawDay === undefined || text(rawDay) === "" && !(rawDay instanceof Date) && typeof rawDay !== "number") return skip("no date");
    const day = dayOf(rawDay, order);
    if (!day) return skip(`"${text(rawDay) || String(rawDay)}" is not a date`);
    const base = {
      day, category: text(get(cells, "category")).slice(0, 200), party: text(get(cells, "party")).slice(0, 200), note: text(get(cells, "note")).slice(0, 300),
      paid: col("paid") >= 0 ? parsePaid(get(cells, "paid")) : null,
      paidOn: col("paidOn") >= 0 ? dayOf(get(cells, "paidOn"), payOrder) : null,
      src: { sheet: g.name, row: rowNo },
    };
    if (base.paidOn && base.paid === null) base.paid = true;
    const add = (direction: "in" | "out", amount: number) => sheet.entries.push({ ...base, direction, amount: Math.round(amount * 100) / 100 });
    if (layout === "inout") {
      const a = cleanNum(get(cells, "in") as Cell) ?? 0, b = cleanNum(get(cells, "out") as Cell) ?? 0;
      if (!a && !b) return skip("no amount");
      if (a) add("in", a);
      if (b) add("out", b);
      return;
    }
    const amount = cleanNum(get(cells, "amount") as Cell);
    if (!amount) return skip("no amount");
    if (layout === "typed") {
      const t = normAr(text(get(cells, "type")));
      const dir = IN_WORD.test(t) ? "in" : OUT_WORD.test(t) ? "out" : null;
      if (!dir) return skip(`type "${text(get(cells, "type"))}" is neither money in nor money out`);
      return add(dir, amount);
    }
    add(kind!, amount);
  });
  return sheet;
}

export interface CashBook { sheets: CashSheet[]; entries: CashEntry[]; skipped: CashSkip[]; months: string[]; ignored: string[] }

/** Every sheet of an upload: the cash sheets read, the others named as left out. */
export function readCashBook(grids: Grid[], opts: { kinds?: Record<string, "in" | "out">; map?: Record<string, CashField | ""> } = {}): CashBook {
  const sheets: CashSheet[] = [], ignored: string[] = [];
  for (const g of grids) {
    const s = readCashGrid(g, { kind: opts.kinds?.[g.name], map: opts.map });
    if (s) sheets.push(s); else ignored.push(g.name);
  }
  const entries = sheets.flatMap((s) => s.entries);
  return { sheets, entries, skipped: sheets.flatMap((s) => s.skipped), months: [...new Set(entries.map((e) => e.day.slice(0, 7)))].sort(), ignored };
}

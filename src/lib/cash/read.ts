import { arToLatin, cleanNum, detectDateOrder, monthHeading, normAr, parseDay, type Cell, type DateOrder } from "@/lib/ingest/parse";
import type { Grid } from "@/lib/ingest/extract";
import { PAID_ON_RX, PAID_RX, parsePaid } from "@/lib/ingest/simple-cols";

/**
 * The cash book's own reader: a small company's sheet of money in and money out, however it is kept. Headings are
 * matched by meaning (English or Arabic, with units and extra words), the heading row can be anywhere, and columns
 * with no useful heading are found from what they hold. It reads In/Out columns (also Debit/Credit and
 * Receipts/Payments), one Amount with a Type column, an Amount on a Sales or Expenses sheet, one signed Amount,
 * Qty × Price, day numbers on a month tab, sales and expenses side by side, and months across the columns. Every
 * sheet comes back with what was read, every row left out with its reason, and notes the screen turns into advice.
 * Nothing from the ledger readers: no accounts, sheet roles, checks or Odoo layouts.
 */
export type CashField = "date" | "in" | "out" | "amount" | "type" | "category" | "party" | "note" | "paid" | "paidOn" | "qty" | "price" | "balance";
export type CashKind = "in" | "out" | "signed";
export interface CashEntry {
  day: string; direction: "in" | "out"; amount: number; category: string; party: string; note: string;
  paid: boolean | null; paidOn: string | null;
  src: { sheet: string; row: number };
}
export type CashSkipCode = "total" | "noDate" | "badDate" | "noAmount" | "badType" | "tooSmall" | "tooLarge";
export interface CashSkip { sheet: string; row: number; reason: string; code: CashSkipCode; cell?: string; value?: string }
export type CashNoteCode =
  | "noDate" | "noAmount" | "needMonth" | "needYear"
  | "debitCredit" | "signed" | "qtyPrice" | "negOut" | "refunds" | "dayNumbers" | "monthly" | "dateOrder" | "duplicates" | "farDates"
  | "dateByContent" | "amountByContent" | "categoryByContent"
  | "balance" | "unused" | "titleRows";
export interface CashNote { code: CashNoteCode; level: "fix" | "check" | "info"; args?: Record<string, string | number> }
export type CashLayout = "inout" | "typed" | "amount" | "signed" | "monthly" | "none";
export interface CashColumn { index: number; letter: string; heading: string; field: CashField | null }
export interface CashSheet {
  /** The sheet's name; a block of a sheet holding two tables side by side is "Sheet · D–F". */
  sheet: string;
  /** The workbook sheet it came from. */
  source: string;
  /** Index (in the read grid) of the heading row; -1 when none was found. */
  headerRow: number;
  layout: CashLayout;
  columns: CashColumn[];
  /** An amount-only sheet whose name and headings do not say sales or expenses: the person says which. */
  needsKind: boolean;
  kind: CashKind | null;
  /** ready: can be saved; choices: waits for the person's choice; blocked: cannot be read until something changes. */
  status: "ready" | "choices" | "blocked";
  /** Months-across sheets: each row's name and which way it was read. */
  rowLabels?: { label: string; direction: "in" | "out" }[];
  /** Rows holding only a title ("Utilities") between entries: left out quietly. */
  sections: number;
  entries: CashEntry[]; skipped: CashSkip[]; notes: CashNote[];
}
export interface CashSheetOptions { kind?: CashKind; headerRow?: number; swap?: boolean; flip?: Record<string, "in" | "out"> }
export interface CashReadOptions { kind?: CashKind; map?: Record<string, CashField | "">; headerRow?: number; swap?: boolean; flip?: Record<string, "in" | "out"> }

// ---------- headings ----------

/** Heading → words: Arabic spellings evened out, units, brackets, currency and punctuation dropped, "ال" taken off. */
function words(h: string): string {
  const s = normAr(arToLatin(h)).toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/ج\s*\.?\s*م\.?|جنيه|ريال|دولار/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\b(egp|le|usd|eur|gbp|sar|aed)\b/g, " ")
    .replace(/\s+/g, " ").trim();
  return s.split(" ").map((w) => (w.length > 4 && w.startsWith("ال") ? w.slice(2) : w)).join(" ");
}
const list = (...ws: string[]) => ws.map(words);
const has = (t: string, ps: string[]) => ps.some((p) => p && ` ${t} `.includes(` ${p} `));

const W = {
  ignore: list("no", "number", "ref", "reference", "invoice no", "receipt no", "code", "id", "serial", "sn", "method", "payment method", "رقم", "كود", "مسلسل", "م", "طريقه الدفع", "رقم الفاتوره"),
  balance: list("balance", "running balance", "رصيد"),
  qty: list("qty", "quantity", "pcs", "pieces", "units", "count", "كميه", "عدد"),
  category: list("category", "item", "items", "product", "products", "account", "expense type", "type of expense", "expense item", "expense category", "بند", "صنف", "اصناف", "فئه", "تصنيف", "منتج", "نوع المصروف", "بند المصروف", "حساب"),
  date: list("date", "day", "dated", "تاريخ", "يوم"),
  price: list("price", "unit price", "rate", "unit cost", "سعر", "سعر الوحده"),
  amountish: list("total", "amount", "value", "sum", "net", "اجمالي", "مبلغ", "قيمه", "مجموع", "صافي"),
  debit: list("debit", "dr", "مدين"),
  credit: list("credit", "cr", "دائن"),
  in: list("in", "money in", "cash in", "sale", "sales", "income", "incoming", "revenue", "revenues", "receipt", "receipts", "received", "takings", "deposit", "deposits", "collections", "مبيعات", "مبيعه", "بيع", "ايراد", "ايرادات", "وارد", "مقبوضات", "مقبوض", "تحصيل", "تحصيلات", "دخل", "داخل"),
  out: list("out", "money out", "cash out", "expense", "expenses", "spent", "spending", "payment", "payments", "paid out", "cost", "costs", "purchase", "purchases", "withdrawal", "withdrawals", "مصروف", "مصروفات", "مصاريف", "منصرف", "صادر", "مدفوعات", "مشتريات", "خارج", "صرف"),
  amount: list("amount", "value", "total", "sum", "net", "net amount", "مبلغ", "قيمه", "اجمالي", "مجموع", "صافي"),
  type: list("type", "kind", "in out", "direction", "movement", "نوع", "نوع الحركه", "حركه", "نوع العمليه"),
  party: list("customer", "client", "supplier", "vendor", "party", "who", "name", "paid to", "received from", "عميل", "مورد", "اسم", "جهه", "مستفيد"),
  note: list("description", "details", "detail", "note", "notes", "memo", "remarks", "statement", "narration", "بيان", "وصف", "تفاصيل", "ملاحظات", "ملاحظه"),
};

/** What a heading means; `dc` marks Debit/Credit read as money in/out. */
function classify(heading: string): { field: CashField | null; dc?: "debit" | "credit" } {
  const raw = normAr(heading.replace(/\s*\*\s*$/, "").replace(/\s+/g, " ").trim());
  if (!raw) return { field: null };
  if (PAID_ON_RX.test(raw)) return { field: "paidOn" };
  if (PAID_RX.test(raw)) return { field: "paid" };
  const t = words(heading);
  if (!t) return { field: null };
  if (has(t, W.ignore) && !has(t, W.date) && !has(t, W.amount)) return { field: null };
  if (has(t, W.balance)) return { field: "balance" };
  if (has(t, W.qty)) return { field: "qty" };
  if (has(t, W.category)) return { field: "category" };
  if (has(t, W.date)) return { field: "date" };
  if (has(t, W.price) && !has(t, W.amountish)) return { field: "price" };
  if (has(t, W.debit)) return { field: "in", dc: "debit" };
  if (has(t, W.credit)) return { field: "out", dc: "credit" };
  if (has(t, W.in)) return { field: "in" };
  if (has(t, W.out)) return { field: "out" };
  if (has(t, W.amount)) return { field: "amount" };
  if (has(t, W.type)) return { field: "type" };
  if (has(t, W.party)) return { field: "party" };
  if (has(t, W.note)) return { field: "note" };
  return { field: null };
}

const IN_WORD = list("in", "money in", "cash in", "sale", "sales", "income", "receipt", "received", "revenue", "deposit", "collection", "دخل", "وارد", "داخل", "بيع", "مبيعات", "ايراد", "ايرادات", "مقبوض", "تحصيل");
const OUT_WORD = list("out", "money out", "cash out", "expense", "expenses", "cost", "payment", "purchase", "spent", "withdrawal", "مصروف", "مصروفات", "صرف", "منصرف", "خارج", "صادر", "شراء", "مشتريات", "دفع");
const SALES_SHEET = list("sales", "sale", "income", "revenue", "revenues", "takings", "money in", "receipts", "مبيعات", "ايرادات", "ايراد", "وارد", "دخل");
const EXPENSE_SHEET = list("expense", "expenses", "costs", "spending", "money out", "purchases", "مصروفات", "مصاريف", "منصرف", "صادر", "مشتريات");
const TOTAL = /^(total|grand total|totals|sum|subtotal|sub total|sub-total|الإجمالي|الاجمالي|المجموع|إجمالي|اجمالي|المجموع الفرعي)\b/i;

/** The key a heading is remembered by (case, spaces, a trailing "*" and Arabic spellings ignored). */
export const cashHeadingKey = (h: string) => normAr(h.replace(/\s*\*\s*$/, "").replace(/\s+/g, " ").trim()).toLowerCase();
const text = (c: Cell) => (c === null || c === undefined ? "" : c instanceof Date ? "" : String(c).replace(/\s+/g, " ").trim());
const blank = (c: Cell) => !(c instanceof Date) && typeof c !== "number" && text(c) === "";
function colLetter(c: number): string { let s = ""; for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; }

// ---------- dates ----------

const pad = (n: number) => String(n).padStart(2, "0");
function ymd(y: number, m: number, d: number): string | null {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2200)) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
}
const monthOf = (w: string) => { const m = monthHeading(w); return m && m.year === null ? m.month : null; };
/** "1-Mar-2026", "2 March 2026", "March 1, 2026", "Mar-02-2026", "١ مارس ٢٠٢٦". */
function wordDate(s: string): string | null {
  const parts = arToLatin(s).toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1").split(/[\s,./-]+/).filter(Boolean);
  if (parts.length !== 3) return null;
  const yr = (x: string) => (/^\d{4}$/.test(x) ? +x : /^\d{2}$/.test(x) ? 2000 + +x : null);
  const [a, b, c] = parts;
  let m: number | null;
  if (/^\d{1,2}$/.test(a) && (m = monthOf(b)) && yr(c)) return ymd(yr(c)!, m, +a);
  if ((m = monthOf(a)) && /^\d{1,2}$/.test(b) && yr(c)) return ymd(yr(c)!, m, +b);
  if (/^\d{4}$/.test(a) && (m = monthOf(b)) && /^\d{1,2}$/.test(c)) return ymd(+a, m, +c);
  return null;
}
const dayNumber = (c: Cell): number | null => {
  const n = typeof c === "number" ? c : typeof c === "string" && /^\d{1,2}$/.test(arToLatin(c.trim())) ? +arToLatin(c.trim()) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
};

interface DateCtx { order: DateOrder; date1904: boolean; month: { y: number; m: number } | null; dayMode: boolean }
function dayOf(c: Cell, ctx: DateCtx): string | null {
  if (ctx.dayMode) { const d = dayNumber(c); if (d !== null) return ctx.month ? ymd(ctx.month.y, ctx.month.m, d) : null; }
  if (typeof c === "number") {
    if (c > 20000 && c < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + (Math.round(c) + (ctx.date1904 ? 1462 : 0)) * 86_400_000);
      return d.toISOString().slice(0, 10);
    }
    return null;
  }
  if (typeof c === "string") {
    const s = arToLatin(c.trim()).replace(/[T\s]+\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*(am|pm|ص|م)?\s*(z|[+-]\d{2}:?\d{2})?$/i, "").trim();
    return parseDay(s, ctx.order) ?? wordDate(s);
  }
  return parseDay(c, ctx.order);
}
/** A month and year written in a sheet's name or a title row: "January 2026", "مارس 2026", "Summary 2026" (year only → null). */
function monthYear(s: string): { y: number; m: number } | null {
  const mh = monthHeading(s);
  return mh && mh.year ? { y: mh.year, m: mh.month } : null;
}
const yearIn = (s: string) => { const m = arToLatin(s).match(/\b(19|20)\d{2}\b/); return m ? +m[0] : null; };

// ---------- one table ----------

function bestHeaderRow(rows: Cell[][], fieldsOf: (r: Cell[]) => (CashField | null)[]): { row: number; found: boolean } {
  let best = -1, bestScore = 0;
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const f = fieldsOf(rows[r] ?? []);
    const recognised = f.filter(Boolean).length;
    if (!recognised && !(rows[r] ?? []).some((c) => text(c) && monthHeading(text(c)))) continue;
    const money = f.some((x) => x === "in" || x === "out" || x === "amount") || (f.includes("qty") && f.includes("price"));
    const months = (rows[r] ?? []).filter((c) => c instanceof Date || (text(c) && monthHeading(text(c)))).length;
    const score = (f.includes("date") ? 4 : 0) + (money ? 3 : 0) + recognised + (months >= 3 ? 8 : 0);
    if (score > bestScore) { best = r; bestScore = score; }
  }
  if (best >= 0) return { row: best, found: true };
  // No heading says anything: the first row with two or more filled cells that has rows under it.
  for (let r = 0; r < Math.min(rows.length - 1, 30); r++) if ((rows[r] ?? []).filter((c) => !blank(c)).length >= 2) return { row: r, found: false };
  return { row: -1, found: false };
}

interface Table { name: string; source: string; rows: Cell[][]; origin: { r: number; c: number }; date1904: boolean }

function readTable(t: Table, opts: CashReadOptions, forcedHeader?: number): CashSheet[] {
  const map = opts.map ?? {};
  const pick = (h: string) => { const k = cashHeadingKey(h); return k in map ? { field: (map[k] || null) as CashField | null, chosen: true } : { ...classify(h), chosen: false }; };
  const rowFields = (r: Cell[]) => r.map((c) => (text(c) ? pick(text(c)).field : null));
  const rowNo = (i: number) => t.origin.r + i + 1;
  const letter = (j: number) => colLetter(t.origin.c + j);
  const notes: CashNote[] = [];
  const note = (code: CashNoteCode, level: CashNote["level"], args?: CashNote["args"]) => { if (!notes.some((n) => n.code === code)) notes.push({ code, level, args }); };

  const hr = forcedHeader ?? opts.headerRow ?? bestHeaderRow(t.rows, rowFields).row;
  const sheet: CashSheet = { sheet: t.name, source: t.source, headerRow: hr, layout: "none", columns: [], needsKind: false, kind: null, status: "blocked", sections: 0, entries: [], skipped: [], notes };
  if (hr < 0 || hr >= t.rows.length) { note("noDate", "fix"); return [sheet]; }
  const head = t.rows[hr] ?? [];
  const width = Math.max(head.length, ...t.rows.slice(hr + 1, hr + 60).map((r) => r?.length ?? 0));
  const picked = Array.from({ length: width }, (_, j) => (text(head[j]) ? pick(text(head[j])) : { field: null as CashField | null, chosen: false }));
  const fields = picked.map((p) => p.field);
  const body = t.rows.slice(hr + 1);
  const sample = (j: number) => body.slice(0, 200).map((r) => r?.[j]).filter((c) => !blank(c));
  const numericShare = (j: number) => { const s = sample(j); return s.length ? s.filter((c) => cleanNum(c) !== null).length / s.length : 0; };
  if (hr > 0 && t.rows.slice(0, hr).some((r) => (r ?? []).some((c) => !blank(c)))) note("titleRows", "info", { rows: hr });

  // Two tables side by side ("Date | Sales || Date | Expense | Amount"): each block read on its own.
  const dateCols = fields.flatMap((f, j) => (f === "date" ? [j] : []));
  if (forcedHeader === undefined && dateCols.length >= 2) {
    const cuts = [0, ...dateCols.slice(1), width];
    return cuts.slice(0, -1).flatMap((a, i) => {
      const b = cuts[i + 1];
      const rows = t.rows.map((r) => (r ?? []).slice(a, b));
      return readTable({ ...t, name: `${t.name} · ${letter(a)}–${letter(b - 1)}`, rows, origin: { r: t.origin.r, c: t.origin.c + a } }, { ...opts, headerRow: undefined }, hr);
    });
  }

  // Months across the columns ("Item | Jan | Feb | Mar"): monthly totals.
  const monthCols = head.map((c, j) => ({ j, mh: c instanceof Date ? { month: c.getMonth() + 1, year: c.getFullYear() } : text(c) ? monthHeading(text(c)) : null })).filter((x) => x.mh);
  if (monthCols.length >= 3 && !fields.includes("date")) return [readMonthly(t, sheet, monthCols as { j: number; mh: { month: number; year: number | null } }[], opts, note, rowNo)];

  // A column whose heading says money but which holds words ("Expense": Rent, Electric) is what it was spent on.
  fields.forEach((f, j) => {
    if (picked[j].chosen || !(f === "in" || f === "out" || f === "amount")) return;
    const s = sample(j);
    if (s.length && numericShare(j) < 0.4) {
      fields[j] = f !== "amount" && !fields.includes("category") ? "category" : null;
      if (fields[j] === "category") note("categoryByContent", "info", { column: `${letter(j)} ${text(head[j])}` });
    }
  });
  // Only the first column of each kind is used.
  const seen = new Set<CashField>();
  fields.forEach((f, j) => { if (!f) return; if (seen.has(f)) fields[j] = null; else seen.add(f); });

  // Date and amount found from what columns hold when no heading says so.
  const dateShare = (j: number, ctx: DateCtx) => { const s = sample(j); return s.length ? s.filter((c) => dayOf(c, ctx) !== null).length / s.length : 0; };
  const probe: DateCtx = { order: "dmy", date1904: t.date1904, month: null, dayMode: false };
  if (!fields.includes("date")) {
    const j = fields.findIndex((f, k) => f === null && sample(k).length > 0 && (dateShare(k, probe) >= 0.6 || dateShare(k, { ...probe, order: "mdy" }) >= 0.6));
    if (j >= 0) { fields[j] = "date"; note("dateByContent", "info", { column: `${letter(j)} ${text(head[j]) || ""}`.trim() }); }
  }
  const hasMoney = () => fields.includes("in") || fields.includes("out") || fields.includes("amount") || (fields.includes("qty") && fields.includes("price"));
  if (!hasMoney()) {
    const nums = fields.flatMap((f, k) => (f === null && sample(k).length > 0 && numericShare(k) >= 0.8 && dateShare(k, probe) < 0.6 ? [k] : []));
    if (nums.length === 1) { fields[nums[0]] = "amount"; note("amountByContent", "info", { column: `${letter(nums[0])} ${text(head[nums[0]]) || ""}`.trim() }); }
  }
  sheet.columns = Array.from({ length: width }, (_, index) => ({ index, letter: letter(index), heading: text(head[index]), field: fields[index] ?? null }));
  const unused = sheet.columns.filter((c) => c.heading && c.field === null).map((c) => `${c.letter} ${c.heading}`);
  if (unused.length) note("unused", "info", { columns: unused.join(", ") });
  const bal = sheet.columns.find((c) => c.field === "balance");
  if (bal) note("balance", "info", { column: `${bal.letter} ${bal.heading}` });
  if (!fields.includes("date")) note("noDate", "fix");
  if (!hasMoney()) note("noAmount", "fix");
  if (!fields.includes("date") || !hasMoney()) return [sheet];

  let col = (f: CashField) => fields.indexOf(f);
  // Debit/Credit as money in/out, unless the person says they are the other way round.
  const dc = picked.some((p, j) => p.dc && fields[j] === (p.dc === "debit" ? "in" : "out"));
  if (dc) note("debitCredit", "check");
  if (opts.swap && (col("in") >= 0 || col("out") >= 0)) {
    const i = col("in"), o = col("out");
    if (i >= 0) fields[i] = "out";
    if (o >= 0) fields[o] = "in";
    col = (f: CashField) => fields.indexOf(f);
    sheet.columns = sheet.columns.map((c) => ({ ...c, field: fields[c.index] ?? null }));
  }

  // Dates: day numbers on a month tab, otherwise the column's day/month order.
  const dates = body.map((r) => r?.[col("date")]).filter((c) => !blank(c));
  const dayMode = dates.length > 0 && dates.filter((c) => dayNumber(c) !== null).length / dates.length >= 0.6;
  let month: DateCtx["month"] = null;
  if (dayMode) {
    month = monthYear(t.source) ?? t.rows.slice(0, hr).flatMap((r) => (r ?? []).map((c) => (c instanceof Date ? { y: c.getFullYear(), m: c.getMonth() + 1 } : monthYear(text(c))))).find(Boolean) ?? null;
    if (!month) { note("needMonth", "fix"); return [sheet]; }
    note("dayNumbers", "info", { month: `${month.y}-${pad(month.m)}` });
  }
  const det = detectDateOrder(dates);
  const ctx: DateCtx = { order: det.order ?? "dmy", date1904: t.date1904, month, dayMode };
  if (!det.order && !dayMode) {
    const amb = dates.find((c) => typeof c === "string" && /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/.test(arToLatin(c.trim())) && (() => { const m = arToLatin(c.trim()).match(/^(\d{1,2})[-/.](\d{1,2})/)!; return m[1] !== m[2]; })());
    if (amb) note("dateOrder", "check", { sample: text(amb) });
  }
  const payCtx: DateCtx = { ...ctx, dayMode: false, order: col("paidOn") >= 0 ? detectDateOrder(body.map((r) => r?.[col("paidOn")])).order ?? ctx.order : ctx.order };

  // Which way an amount-only sheet goes: the person, the sheet's name, a heading's words, or the signs in it.
  const layout0: CashLayout = col("in") >= 0 || col("out") >= 0 ? "inout" : col("type") >= 0 ? "typed" : "amount";
  const amountOf = (r: Cell[]): number | null => {
    if (col("amount") >= 0) return cleanNum(r[col("amount")] ?? null);
    const q = cleanNum(r[col("qty")] ?? null), p = cleanNum(r[col("price")] ?? null);
    return q !== null && p !== null ? q * p : null;
  };
  let kind: CashKind | null = null;
  if (layout0 === "amount") {
    const nameWords = words(t.source);
    const headWords = head.map((c) => words(text(c))).join(" ");
    const named = has(nameWords, SALES_SHEET) ? "in" : has(nameWords, EXPENSE_SHEET) ? "out" : has(headWords, IN_WORD) && !has(headWords, OUT_WORD) ? "in" : has(headWords, OUT_WORD) && !has(headWords, IN_WORD) ? "out" : null;
    const amounts = body.map((r) => amountOf(r ?? [])).filter((x): x is number => x !== null && x !== 0);
    const mixed = amounts.some((x) => x < 0) && amounts.some((x) => x > 0);
    kind = opts.kind ?? named ?? (mixed ? "signed" : null);
    if (col("amount") < 0) note("qtyPrice", "check", { qty: text(head[col("qty")]), price: text(head[col("price")]) });
  }
  const layout: CashLayout = layout0 === "amount" && kind === "signed" ? "signed" : layout0;
  if (layout === "signed") note("signed", "check");
  sheet.layout = layout;
  sheet.kind = kind;
  sheet.needsKind = layout === "amount" && !kind;
  if (sheet.needsKind) { sheet.status = "choices"; return [sheet]; }

  const get = (r: Cell[], f: CashField) => (col(f) >= 0 ? r[col(f)] : null);
  let negOut = 0, refunds = 0;
  const dupes = new Map<string, number[]>();
  body.forEach((r, i) => {
    const cells = r ?? [];
    const row = rowNo(hr + 1 + i);
    if (cells.every(blank)) return;
    const skip = (code: CashSkipCode, reason: string, j?: number, value?: string) => sheet.skipped.push({ sheet: t.name, row, reason, code, cell: j !== undefined && j >= 0 ? `${letter(j)}${row}` : undefined, value });
    const first = cells.map(text).find(Boolean) ?? "";
    if (TOTAL.test(normAr(first))) return skip("total", "total row");
    // Any amount on the row at all (to tell a title row from an entry with a bad date).
    const moneyCols = (["in", "out", "amount", "qty", "price"] as CashField[]).map(col).filter((j) => j >= 0);
    const anyAmount = moneyCols.some((j) => { const n = cleanNum(cells[j] ?? null); return n !== null && n !== 0; });
    const rawDay = get(cells, "date");
    if (blank(rawDay)) { if (anyAmount) skip("noDate", "no date", col("date")); else sheet.sections++; return; }
    const day = dayOf(rawDay, ctx);
    if (!day) { if (anyAmount) { const v = text(rawDay) || String(rawDay); skip("badDate", `"${v}" is not a date`, col("date"), v); } else sheet.sections++; return; }
    const base = {
      day, category: text(get(cells, "category")).slice(0, 200), party: text(get(cells, "party")).slice(0, 200), note: text(get(cells, "note")).slice(0, 300),
      paid: col("paid") >= 0 ? parsePaid(get(cells, "paid")) : null,
      paidOn: col("paidOn") >= 0 ? dayOf(get(cells, "paidOn"), payCtx) : null,
      src: { sheet: t.name, row },
    };
    if (base.paidOn && base.paid === null) base.paid = true;
    const pending: [("in" | "out"), number, number][] = [];
    const take = (direction: "in" | "out", amount: number, j: number) => pending.push([direction, amount, j]);
    if (layout === "inout") {
      const a = cleanNum(get(cells, "in") as Cell) ?? 0, b = cleanNum(get(cells, "out") as Cell) ?? 0;
      if (!a && !b) return skip("noAmount", "no amount");
      if (a) { if (a < 0) refunds++; take("in", a, col("in")); }
      if (b) { if (b < 0) negOut++; take("out", Math.abs(b), col("out")); }
    } else {
      const amount = amountOf(cells);
      if (!amount) return skip("noAmount", "no amount", col("amount"));
      if (layout === "typed") {
        const ty = words(text(get(cells, "type")));
        const dir = has(ty, IN_WORD) ? "in" : has(ty, OUT_WORD) ? "out" : null;
        if (!dir) { const v = text(get(cells, "type")); return skip("badType", `type "${v}" is neither money in nor money out`, col("type"), v); }
        take(dir, dir === "out" ? Math.abs(amount) : amount, col("amount"));
      } else if (layout === "signed") take(amount > 0 ? "in" : "out", Math.abs(amount), col("amount"));
      else { if (kind === "out" && amount < 0) negOut++; else if (amount < 0) refunds++; take(kind as "in" | "out", kind === "out" ? Math.abs(amount) : amount, col("amount")); }
    }
    for (const [direction, amount, j] of pending) {
      const v = Math.round(amount * 100) / 100;
      if (v === 0) { skip("tooSmall", "amount too small", j, String(amount)); continue; }
      if (Math.abs(v) >= 1e12) { skip("tooLarge", "amount too large", j, String(amount)); continue; }
      const e = { ...base, direction, amount: v };
      sheet.entries.push(e);
      const k = [e.day, e.direction, e.amount, e.category, e.party, e.note].join("|");
      dupes.set(k, [...(dupes.get(k) ?? []), row]);
    }
  });
  if (negOut) note("negOut", "check", { n: negOut });
  if (refunds) note("refunds", "check", { n: refunds });
  const twice = [...dupes.values()].filter((rs) => rs.length > 1);
  if (twice.length) note("duplicates", "check", { n: twice.length, rows: twice.slice(0, 5).map((rs) => rs.join(" & ")).join(", ") });
  const years = sheet.entries.map((e) => +e.day.slice(0, 4)).sort((a, b) => a - b);
  if (years.length) {
    const mid = years[Math.floor(years.length / 2)];
    const far = sheet.entries.filter((e) => Math.abs(+e.day.slice(0, 4) - mid) > 3);
    if (far.length) note("farDates", "fix", { n: far.length, rows: far.slice(0, 5).map((e) => `${e.src.row} (${e.day})`).join(", ") });
  }
  sheet.status = "ready";
  return [sheet];
}

function readMonthly(t: Table, sheet: CashSheet, monthCols: { j: number; mh: { month: number; year: number | null } }[], opts: CashReadOptions,
  note: (code: CashNoteCode, level: CashNote["level"], args?: CashNote["args"]) => void, rowNo: (i: number) => number): CashSheet {
  const hr = sheet.headerRow;
  const head = t.rows[hr] ?? [];
  const monthIdx = new Set(monthCols.map((m) => m.j));
  const titleYear = t.rows.slice(0, hr).flatMap((r) => (r ?? []).map((c) => yearIn(text(c)))).find((y) => y !== null) ?? null;
  const year = yearIn(t.source) ?? titleYear;
  sheet.layout = "monthly";
  sheet.columns = head.map((c, index) => ({ index, letter: colLetter(t.origin.c + index), heading: text(c), field: null }));
  if (monthCols.some((m) => !m.mh.year) && !year) { note("needYear", "fix"); return sheet; }
  const body = t.rows.slice(hr + 1);
  const labelCol = head.findIndex((_, j) => !monthIdx.has(j) && body.some((r) => text(r?.[j]) && cleanNum(r?.[j] ?? null) === null));
  const labels: CashSheet["rowLabels"] = [];
  body.forEach((r, i) => {
    const cells = r ?? [];
    const row = rowNo(hr + 1 + i);
    if (cells.every(blank)) return;
    const label = labelCol >= 0 ? text(cells[labelCol]) : "";
    if (TOTAL.test(normAr(label))) { sheet.skipped.push({ sheet: t.name, row, reason: "total row", code: "total" }); return; }
    const direction = opts.flip?.[label] ?? (has(words(label), IN_WORD) ? "in" : "out");
    let used = false;
    for (const { j, mh } of monthCols) {
      const n = cleanNum(cells[j] ?? null);
      if (!n) continue;
      const v = Math.round((direction === "out" ? Math.abs(n) : n) * 100) / 100;
      if (!v || Math.abs(v) >= 1e12) continue;
      sheet.entries.push({ day: `${mh.year ?? year}-${pad(mh.month)}-01`, direction, amount: v, category: label.slice(0, 200), party: "", note: "", paid: null, paidOn: null, src: { sheet: t.name, row } });
      used = true;
    }
    if (used) labels.push({ label, direction });
    else if (label) sheet.sections++;
  });
  sheet.rowLabels = labels;
  note("monthly", "check", { rows: labels.map((l) => `${l.label} → ${l.direction}`).join(", ") });
  sheet.status = sheet.entries.length ? "ready" : "blocked";
  return sheet;
}

/**
 * One sheet (or, when it holds two tables side by side, one sheet per table). `kind` says whether an amount-only
 * sheet is money in, money out or signed; `map` holds the person's column choices by heading; `headerRow` the row
 * they say holds the headings; `swap` turns In/Out (or Debit/Credit) round; `flip` sets a months-across row's way.
 */
export function readCashSheets(g: Grid, opts: CashReadOptions = {}): CashSheet[] {
  const rows = g.rows ?? [];
  if (!rows.some((r) => (r ?? []).some((c) => !blank(c)))) return [];
  return readTable({ name: g.name, source: g.name, rows, origin: g.origin ?? { r: 0, c: 0 }, date1904: Boolean(g.date1904) }, opts);
}

/** The first table of a sheet; null for an empty sheet. Kept for callers that read one table at a time. */
export function readCashGrid(g: Grid, opts: CashReadOptions = {}): CashSheet | null {
  return readCashSheets(g, opts)[0] ?? null;
}

export interface CashBook { sheets: CashSheet[]; entries: CashEntry[]; skipped: CashSkip[]; months: string[]; ignored: string[] }

/** Every sheet of an upload: each table read (or the reason it cannot be yet); empty sheets named as left out. */
export function readCashBook(grids: Grid[], opts: { kinds?: Record<string, CashKind>; map?: Record<string, CashField | "">; sheets?: Record<string, CashSheetOptions> } = {}): CashBook {
  const sheets: CashSheet[] = [], ignored: string[] = [];
  for (const g of grids) {
    const o = opts.sheets?.[g.name] ?? {};
    const first = readCashSheets(g, { map: opts.map, kind: o.kind ?? opts.kinds?.[g.name], headerRow: o.headerRow, swap: o.swap, flip: o.flip });
    if (!first.length) { ignored.push(g.name); continue; }
    // A block of a side-by-side sheet takes its own choices when the person made some for it.
    for (const s of first) {
      const bo = s.sheet !== g.name ? opts.sheets?.[s.sheet] ?? (opts.kinds?.[s.sheet] ? { kind: opts.kinds[s.sheet] } : null) : null;
      if (bo) {
        const again = readCashSheets(g, { map: opts.map, headerRow: o.headerRow, ...bo }).find((x) => x.sheet === s.sheet);
        sheets.push(again ?? s);
      } else sheets.push(s);
    }
  }
  const entries = sheets.flatMap((s) => s.entries);
  return { sheets, entries, skipped: sheets.flatMap((s) => s.skipped), months: [...new Set(entries.map((e) => e.day.slice(0, 7)))].sort(), ignored };
}

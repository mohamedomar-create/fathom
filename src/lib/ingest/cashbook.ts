import type { ClassKey } from "@/lib/engine";
import { arRx, cleanNum, detectDateOrder, monthHeading, normAr, parseDay, type Cell, type DateOrder, TOTAL_LABEL } from "./parse";
import { str, type Grid } from "./extract";
import { applyFixes, cellRef, colLetter, shown, type CellError, type Fixes, type Marks, type TraceRow } from "./trace";
import { sumTerms, termText, type Term } from "./formula";
import { classify } from "./classify";
import { EXPENSE_CLASSES, NO_SUPPLIER, type ExpenseLine } from "./expenses";
import { NO_CATEGORY, NO_CUSTOMER, type SalesLine } from "./sales";

/**
 * A cash book kept by hand: money going out on one side (often one column per kind of cost: fixed, variable,
 * production, salaries) and money coming in on the other (who paid, how much, VAT), grouped under month headings,
 * with the person's own totals in between. Each entry becomes an expense line (money out) or a sales line (money in).
 *
 * Accuracy rules, in order:
 *  - The person's own totals are checked: a SUM formula's cells must hold exactly what iReport read, and every number
 *    a total counts must be one iReport counted. Typed totals ("Total" rows) must add up the same way.
 *  - Nothing is guessed silently: notes, summaries below the totals, figures without a name or date, entries outside
 *    every total and cells counted in two totals are listed; unreadable amounts must be fixed before saving.
 *  - Every line keeps the sheet and row it came from.
 */
export type CashDir = "out" | "in";
export interface CashBlock {
  dir: CashDir;
  /** First and last column of this side of the sheet. */
  c0: number; c1: number;
  label: number;
  date: number | null;
  /** Columns of amounts: for money out, one per kind of cost (its heading names the cost); for money in, the amount. */
  amounts: { col: number; header: string }[];
  vat: number | null;
  product: number | null;
  channel: number | null;
  /** How amounts relate to the VAT column: before VAT (as written), VAT included (taken out), or not consistent. */
  vatMode?: "excluded" | "included" | "mixed" | "owner-net";
}
export interface CashControl {
  row: number; col: number;
  formula: string;
  file: number;
  read: number;
  ok: boolean;
  /** Totals made only of other totals are not reported on their own (their parts are). */
  derived: boolean;
}
export interface CashCheck { row?: number; col?: number; message: string }
export interface CashLayout {
  sheet: string;
  kind: "cashbook";
  headerRow: number;
  blocks: CashBlock[];
  out: { lines: number; total: number };
  in: { lines: number; total: number };
  controls: CashControl[];
  trace: Marks;
  errors: CellError[];
  checks: CashCheck[];
  /** Money in counted as sales (on unless the person turns it off). */
  salesOn: boolean;
  /**
   * Entries the owner's totals count more than once: how much each one makes the owner's figure differ from iReport's,
   * by month and side (a VAT cell counted twice makes the owner's net sales lower; an amount counted twice, higher).
   */
  twice: { row: number; col: number; period: string; side: "sales" | "expenses"; vat: boolean; effect: number }[];
}
export interface CashOverride extends Fixes {
  salesOff?: boolean;
  /** VAT beside sales amounts: take it out ("net"), keep the amounts as written, or follow the file ("auto": the owner's own net formula, else the share). */
  vat?: "auto" | "net" | "asWritten";
  /** The owner's net formula was found on another sheet of the same workbook (it applies to every cash book in it). */
  ownerNet?: boolean;
  /** Which month an entry counts in when a month heading is above it: the heading (the owner's grouping), or its date. */
  months?: "heading" | "date";
}

/** The owner's own "net = amounts − VAT" formula on this sheet ("=L72-M72"): their definition of sales. */
export function ownerNetFormula(g: Grid): string | null {
  const shape = cashBookShape(g.rows, g.formulas, g.origin);
  if (!shape) return null;
  for (const b of shape.blocks) { const f = ownerNetIn(g, b); if (f) return f; }
  return null;
}
function ownerNetIn(g: Grid, b: CashBlock): string | null {
  if (b.vat === null) return null;
  for (const [k, f] of Object.entries(g.formulas ?? {})) {
    const t = sumTerms(f, g.origin ?? { r: 0, c: 0 });
    if (!t) continue;
    const r = Number(k.split(":")[0]);
    if (t.some((x) => x.sign === -1 && x.c0 === b.vat && x.c1 === b.vat && (x.r0 !== r || x.r1 !== r)) && t.some((x) => x.sign === 1 && b.amounts.some((a) => a.col === x.c0 && a.col === x.c1))) return `=${f}`;
  }
  return null;
}

const DATE_HDR = arRx(/^(date|day|payment date|paid on|value date|transaction date|invoice date|التاريخ|تاريخ|تاريخ الدفع|اليوم)$/i);
const VAT_HDR = arRx(/^(vat|tax|v\.a\.t\.?|vat amount|tax amount|ضريبة|الضريبة|ضريبة القيمة المضافة|ق\.م)$/i);
const AMOUNT_HDR = arRx(/^(amount|value|total|net|sales|revenue|paid|received|egp|usd|eur|sar|aed|qar|kwd|gbp|le|l\.e\.?|المبلغ|القيمة|المبيعات|الإجمالي|الاجمالي|جنيه)$/i);
const PRODUCT_HDR = arRx(/^(product|products|item|items|description|details|الصنف|المنتج|البيان|الوصف)$/i);
const CHANNEL_HDR = arRx(/^(client|channel|source|platform|via|العميل|القناة|المصدر)$/i);
const OUT_BANNER = arRx(/^(cash ?out|money ?out|out|outgoings?|payments?|paid|expenses?|spending|costs?|مصروفات|المصروفات|مدفوعات|منصرف|صادر|خارج)$/i);
const IN_BANNER = arRx(/^(cash ?in|money ?in|in|income|incomings?|receipts?|received|sales|revenues?|collections?|إيرادات|الإيرادات|مقبوضات|وارد|داخل|مبيعات|المبيعات|تحصيلات)$/i);
const IN_HDR = arRx(/^(store|shop|customer|client|buyer|sales|revenue|receipts?|received from|from|العميل|المحل|المشتري|المبيعات|من)$/i);
const OUT_HDR = arRx(/(cost|expense|supplier|vendor|paid to|payment|salar|wage|rent|personnel|personel|staff|utilit|transport|marketing|packag|production|مصروف|مورد|تكلفة|رواتب|مرتبات|إيجار|ايجار)/i);
const LEDGER_HDR = arRx(/^(debit|credit|balance|dr|cr|مدين|دائن|الرصيد)$/i);
const TOTAL_ROW = TOTAL_LABEL;

const isNum = (v: Cell) => typeof v === "number" && Number.isFinite(v);
/** Text that is only a number ("1,200", "(350)", "EGP 2,500"): words with a digit in them ("Q1 expenses") are not. */
const numText = (v: Cell) => typeof v === "string" && cleanNum(v) !== null && !/[A-Za-z\u0621-\u064A]/.test(v.replace(/\b(egp|le|l\.e|usd|eur|sar|aed|qar|kwd|gbp)\b|ج\.?م|جنيه/gi, ""));
/** An amount cell's value: a number, or text that is only a number; null for anything else. */
const amt = (v: Cell): number | null => (isNum(v) ? (v as number) : numText(v) ? cleanNum(v) : null);
const blank = (v: Cell) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const round2 = (v: number) => Math.round(v * 100) / 100;
const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
const head = (v: Cell) => normAr(str(v).replace(/\s*\*\s*$/, "").replace(/\s+/g, " ")).trim();
const pad = (n: number) => String(n).padStart(2, "0");

/** The cost class a column heading names ("Fixed Cost", "Production Cost", "Salaries"), when it is clear. */
function costClass(header: string): ClassKey | null {
  const h = header.toLowerCase();
  if (/production|material|manufactur|cost of (sales|goods)|cogs|purchas|تكلفة المبيعات|خامات|انتاج|إنتاج/.test(h)) return "cos_variable";
  if (/variable|متغير/.test(h)) return "exp_variable";
  if (/fixed|personnel|personel|salar|wage|staff|payroll|rent|ثابت|رواتب|مرتبات|أجور|اجور|إيجار|ايجار/.test(h)) return "exp_fixed";
  const c = classify(header, "", "PL").cls;
  return c && EXPENSE_CLASSES.has(c) ? c : null;
}
const titled = (h: string) => h.replace(/\s+/g, " ").trim().replace(/^./, (c) => c.toUpperCase());

/** Finds the heading row and the sides of a cash book, or null when the sheet is not one. */
export function cashBookShape(rows: Cell[][], formulas: Record<string, string> = {}, origin = { r: 0, c: 0 }): { headerRow: number; blocks: CashBlock[] } | null {
  // Columns that add up their own row ("=SUM(B5:E5)" on every line) repeat the other columns: never amounts.
  const rowTotals = new Set<number>();
  const perCol = new Map<number, { same: number; all: number }>();
  for (const [k, f] of Object.entries(formulas)) {
    const [r, c] = k.split(":").map(Number);
    const t = sumTerms(f, origin);
    const e = perCol.get(c) ?? { same: 0, all: 0 };
    e.all++;
    if (t && t.every((x) => x.r0 === r && x.r1 === r) && t.reduce((n, x) => n + x.c1 - x.c0 + 1, 0) >= 2) e.same++;
    perCol.set(c, e);
  }
  for (const [c, e] of perCol) {
    const nums = rows.filter((r) => isNum(r?.[c])).length;
    if (e.same >= 2 && e.same >= nums / 2) rowTotals.add(c);
  }
  const width = Math.max(0, ...rows.slice(0, 400).map((r) => r?.length ?? 0));
  for (let h = 0; h < Math.min(rows.length, 15); h++) {
    const hr = rows[h] ?? [];
    const texts = hr.map(head);
    if (!texts.some((t) => DATE_HDR.test(t)) || texts.filter(Boolean).length < 3) continue;
    // Debit / credit / balance columns make a ledger, a journal or a bank statement: other readers'.
    if (texts.some((t) => LEDGER_HDR.test(t))) return null;
    // Banners above the headings ("Cash OUT" … "Cash IN") say where each side starts and which way the money goes.
    const banners: { col: number; dir: CashDir }[] = [];
    for (let r = 0; r < h; r++) (rows[r] ?? []).forEach((v, c) => {
      const t = head(v);
      if (OUT_BANNER.test(t)) banners.push({ col: c, dir: "out" });
      else if (IN_BANNER.test(t)) banners.push({ col: c, dir: "in" });
    });
    const data = rows.slice(h + 1);
    const empty = (c: number) => blank(hr[c]) && data.every((r) => blank(r?.[c]));
    // Sides: split at banners, and at columns empty from the headings down.
    const starts = new Set<number>([0, ...banners.map((b) => b.col)]);
    for (let c = 0; c < width; c++) if (empty(c) && c + 1 < width && !empty(c + 1)) starts.add(c + 1);
    const cuts = [...starts].sort((a, b) => a - b);
    const blocks: CashBlock[] = [];
    cuts.forEach((c0, i) => {
      let c1 = (cuts[i + 1] ?? width) - 1;
      while (c1 > c0 && empty(c1)) c1--;
      const b = shapeBlock(rows, h, c0, c1, rowTotals, formulas, banners.filter((x) => x.col >= c0 && x.col <= c1).map((x) => x.dir)[0]);
      if (b) blocks.push(b);
    });
    if (!blocks.length) continue;
    // A sheet with only money-in lists is a sales list, read by the sales reader; a cash book has money going out.
    if (!blocks.some((b) => b.dir === "out")) continue;
    return { headerRow: h, blocks };
  }
  return null;
}

function shapeBlock(rows: Cell[][], h: number, c0: number, c1: number, rowTotals: Set<number>, formulas: Record<string, string>, bannerDir?: CashDir): CashBlock | null {
  const hr = rows[h] ?? [];
  const data = rows.slice(h + 1, h + 1 + 600);
  const cols = Array.from({ length: c1 - c0 + 1 }, (_, i) => c0 + i);
  const stat = (c: number) => {
    let n = 0, t = 0, d = 0;
    // Formula cells are the person's totals, never entries: they do not decide what a column holds.
    data.forEach((r, i) => { const v = r?.[c]; if (blank(v) || formulas[`${h + 1 + i}:${c}`]) return; if (v instanceof Date) d++; else if (amt(v) !== null || /^#[A-Z/0!?]+[!?]?$/.test(str(v))) n++; else t++; });
    return { n, t, d };
  };
  const date = cols.find((c) => DATE_HDR.test(head(hr[c]))) ?? null;
  const vat = cols.find((c) => VAT_HDR.test(head(hr[c]))) ?? null;
  const label = cols.find((c) => c !== date && c !== vat && stat(c).t >= Math.max(3, stat(c).n)) ?? null;
  if (label === null) return null;
  const amounts: { col: number; header: string }[] = [];
  for (const c of cols) {
    if (c === date || c === vat || c === label || rowTotals.has(c)) continue;
    const s = stat(c), hd = head(hr[c]);
    if (DATE_HDR.test(hd) || PRODUCT_HDR.test(hd) || CHANNEL_HDR.test(hd)) continue;
    // Numbers at least as often as words, or a heading that names a cost or an amount (a few notes in it do not hide it).
    if (s.n >= 1 && (s.n >= s.t || ((OUT_HDR.test(hd) || AMOUNT_HDR.test(hd)) && s.n >= 2))) amounts.push({ col: c, header: titled(str(hr[c])) || `Column ${colLetter(c)}` });
  }
  if (!amounts.length) return null;
  const heads = cols.map((c) => head(hr[c]));
  let dir: CashDir | null = bannerDir ?? null;
  if (!dir) dir = heads.some((t) => IN_HDR.test(t)) ? "in" : amounts.length >= 2 || heads.some((t) => OUT_HDR.test(t)) ? "out" : null;
  if (!dir) return null;
  // Money in has one amount: the one headed like an amount (EGP, Amount), else the first.
  const inAmount = dir === "in" ? amounts.find((a) => AMOUNT_HDR.test(head(hr[a.col]))) ?? amounts[0] : null;
  const product = cols.find((c) => c !== label && PRODUCT_HDR.test(head(hr[c]))) ?? null;
  const channel = cols.find((c) => c !== label && CHANNEL_HDR.test(head(hr[c]))) ?? null;
  return { dir, c0, c1, label, date, amounts: inAmount ? [inAmount] : amounts, vat, product, channel };
}

interface Section { month: number | null; year: number | null; sales: boolean; heading: string; sub: string; firstDate: string | null }

/** Reads a cash book, or returns null when the sheet is not one. */
export function readCashBook(g: Grid, ov: CashOverride = {}): { sales: SalesLine[]; expenses: ExpenseLine[]; layout: CashLayout } | null {
  const rows = applyFixes(g.rows, ov);
  const shape = cashBookShape(rows, g.formulas, g.origin);
  if (!shape) return null;
  const { headerRow, blocks } = shape;
  const sheet = g.name;
  const origin = g.origin ?? { r: 0, c: 0 };
  const errors: { row: number; col: number; text: string; message: string }[] = [];
  const checks: CashCheck[] = [];
  const marks: (TraceRow[] | undefined)[] = [];
  const addMark = (r: number, t: TraceRow) => { (marks[r] ??= []).push(t); };
  const sales: SalesLine[] = [], expenses: ExpenseLine[] = [];
  // What iReport counted, cell by cell (as written in the file): the person's totals are checked against it.
  const counted = new Map<string, number>();
  const key = (r: number, c: number) => `${r}:${c}`;
  // Formula cells the person retyped are their values now, not totals.
  const formulaAt = (r: number, c: number) => (ov.cells && key(r, c) in ov.cells) || blank(rows[r]?.[c]) ? null : g.formulas?.[key(r, c)] ?? null;
  const multiRow = (r: number, f: string) => { const t = sumTerms(f, origin); return !!t && t.some((x) => x.r0 !== r || x.r1 !== r); };
  const sheetYear = Number(sheet.match(/\b(20\d{2})\b/)?.[1] ?? 0) || null;
  const outsideHeading: number[] = [];
  const typed: CashControl[] = [];
  const twice: CashLayout["twice"] = [];
  const summaryNoted = new Set<number>();
  const byHeading = (ov.months ?? "heading") === "heading";

  for (const b of blocks) {
    const order: DateOrder = b.date !== null ? detectDateOrder(rows.slice(headerRow + 1).map((r) => r?.[b.date!])).order ?? "dmy" : "dmy";
    const amountCols = [...b.amounts.map((a) => a.col), ...(b.vat !== null ? [b.vat] : [])];
    const dayOf = (r: number) => (b.date !== null ? parseDay(rows[r]?.[b.date], order) : null);
    // The person's summary: below the first of their totals that comes after the last dated entry (or month heading), rows without a date
    // (sales and costs per quarter, profit, notes) are never entries.
    const totalRows: number[] = [];
    let lastDated = -1;
    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r] ?? [];
      const totalCell = amountCols.some((c) => { const f = formulaAt(r, c); return f !== null && multiRow(r, f); });
      if (totalCell || (TOTAL_ROW.test(head(row[b.label])) && amountCols.some((c) => amt(row[c]) !== null))) totalRows.push(r);
      else if (dayOf(r) && amountCols.some((c) => (amt(row[c]) ?? 0) !== 0)) lastDated = r;
      // A month heading starts entries again (books where undated lines sit under "November sales").
      else if (!dayOf(r) && monthHeading(str(row[b.label])) && !amountCols.some((c) => amt(row[c]) !== null)) lastDated = r;
    }
    const summaryFrom = totalRows.find((r) => r > lastDated) ?? Infinity;
    const years = new Map<number, number>();
    for (let r = headerRow + 1; r < rows.length; r++) { const d = dayOf(r); if (d) years.set(+d.slice(0, 4), (years.get(+d.slice(0, 4)) ?? 0) + 1); }
    const commonYear = [...years].sort((a, b2) => b2[1] - a[1])[0]?.[0] ?? null;
    let sec: Section = { month: null, year: null, sales: false, heading: "", sub: "", firstDate: null };
    const vatPairs: { r: number; amount: number; vat: number }[] = [];
    const blockLines: { r: number; line: SalesLine | ExpenseLine; written: number; vat: number | null }[] = [];

    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r] ?? [];
      const cells = Array.from({ length: b.c1 - b.c0 + 1 }, (_, i) => row[b.c0 + i]);
      if (cells.every(blank)) continue;
      const label = str(row[b.label]).replace(/\s+/g, " ");
      const day = dayOf(r);
      // A repeated heading row (some books repeat the column headings under each month).
      const hr = rows[headerRow] ?? [];
      if (cells.filter((v, i) => !blank(v) && head(v) === head(hr[b.c0 + i])).length >= 3) { addMark(r, { role: "header" }); continue; }
      const totalCell = amountCols.some((c) => { const f = formulaAt(r, c); return f !== null && multiRow(r, f); });
      if (totalCell) { addMark(r, { role: "total", note: "your total, checked below" }); continue; }
      const nums = amountCols.filter((c) => (amt(row[c]) ?? 0) !== 0);
      const textInAmounts = b.amounts.filter((a) => !blank(row[a.col]) && amt(row[a.col]) === null);
      if (TOTAL_ROW.test(head(label)) && nums.length) { addMark(r, { role: "total", note: "your total, checked below" }); typedTotal(r, b); continue; }
      // Below the last total, rows without a date are the person's own summary (sales and costs per quarter, profit…).
      if (r > summaryFrom && !day) {
        addMark(r, { role: "unused", note: "below your totals: a summary, not entries" });
        if (nums.length && !summaryNoted.has(r) && summaryNoted.add(r)) checks.push({ row: r, message: `${cellRef(r, undefined, origin)}: "${[label, ...nums.map((c) => fmt(amt(row[c])!))].filter(Boolean).join(" ").slice(0, 80)}" is below your totals, so it is read as your summary and not counted.` });
        continue;
      }
      if (!nums.length && !textInAmounts.length) {
        if (!label) { addMark(r, { role: "unused", note: "a note, not an entry" }); continue; }
        const m = !day ? monthHeading(label) : null;
        if (m) {
          sec = { month: m.month, year: m.year, sales: m.sales, heading: label, sub: "", firstDate: null };
          addMark(r, { role: "heading", note: `month heading: ${label}` });
        } else if (!day) {
          if (b.dir === "out") sec = { ...sec, sub: label.replace(/[:：]\s*$/, "").trim() };
          addMark(r, { role: "heading", note: b.dir === "out" ? `group: ${label}` : "a name with no amount" });
        } else addMark(r, { role: "unused", note: "no amount on this row" });
        continue;
      }
      // Words where amounts go, and no date: the person's own notes or summary ("Q2 Revenue", "Remaining").
      if (textInAmounts.length && !day && (!label || !nums.length)) { addMark(r, { role: "unused", note: "a note, not an entry" }); continue; }
      if (!label && !day) {
        addMark(r, { role: "unused", note: "a figure with no name or date" });
        checks.push({ row: r, col: nums[0], message: `${cellRef(r, nums[0], origin)}: ${fmt(amt(row[nums[0]])!)} has no name and no date, so it is not counted. If it is an entry, type what it is for.` });
        continue;
      }
      let bad = false;
      for (const a of textInAmounts) { bad = true; errors.push({ row: r, col: a.col, text: shown(row[a.col]), message: `"${shown(row[a.col])}" is not a number` }); }
      if (bad) { addMark(r, { role: "error", note: "an amount cannot be read" }); continue; }
      // The month: the heading when it says what the rows are for ("DECEMBER 2024 sales"), else the date, else the heading.
      if (day && sec.month !== null && !sec.firstDate) sec.firstDate = day;
      const headingPeriod = () => {
        if (sec.month === null) return null;
        let y = sec.year;
        if (y === null) {
          const fd = sec.firstDate ?? day;
          y = fd ? (sec.month - +fd.slice(5, 7) > 6 ? +fd.slice(0, 4) - 1 : sec.month - +fd.slice(5, 7) < -6 ? +fd.slice(0, 4) + 1 : +fd.slice(0, 4)) : sheetYear ?? commonYear;
        }
        return y ? `${y}-${pad(sec.month)}` : null;
      };
      // The owner's grouping decides (their month headings), unless they chose the dates; with no heading, the date.
      let period: string | null;
      const hp = headingPeriod();
      if (hp && (byHeading || sec.sales)) { period = hp; if (day && !day.startsWith(hp)) outsideHeading.push(r); }
      else if (day) { period = day.slice(0, 7); if (hp && hp !== period) outsideHeading.push(r); }
      else period = hp;
      if (!period) {
        const c = b.date ?? b.label;
        errors.push({ row: r, col: c, text: shown(row[c]), message: str(row[c]) ? `"${shown(row[c])}" is not a date` : "no date on this entry, and no month heading above it" });
        addMark(r, { role: "error", note: "no date" });
        continue;
      }
      const lineDay = day && day.startsWith(period) ? day : null;
      const vat = b.vat !== null ? amt(row[b.vat]) : null;
      if (vat !== null) counted.set(key(r, b.vat!), vat);
      const parts: string[] = [];
      for (const a of b.amounts) {
        const v = amt(row[a.col]);
        if (v === null || v === 0) continue;
        counted.set(key(r, a.col), v);
        if (vat !== null) vatPairs.push({ r, amount: v as number, vat });
        if (b.dir === "out") {
          const line: ExpenseLine = {
            day: lineDay, period, doc: "", series: "", supplier: NO_SUPPLIER, account: a.header, cls: costClass(a.header),
            category: sec.sub || a.header, label: (label || "No description").slice(0, 200), amount: round2(v), src: { sheet, row: r },
          };
          expenses.push(line); blockLines.push({ r, line, written: v as number, vat });
          parts.push(`money out, ${a.header}: ${fmt(v)}`);
        } else {
          const line: SalesLine = {
            day: lineDay, period, doc: "", series: "", customer: label || NO_CUSTOMER,
            product: (b.product !== null ? str(row[b.product]) : "") || "No description", category: (b.channel !== null ? str(row[b.channel]) : "") || NO_CATEGORY,
            salesperson: "", qty: null, amount: round2(v), cost: null, src: { sheet, row: r },
          };
          sales.push(line); blockLines.push({ r, line, written: v as number, vat });
          parts.push(`money in: ${fmt(v)}`);
        }
      }
      addMark(r, { role: "entry", note: parts.join(" · ") });
    }

    // VAT beside the amounts: the share settles whether the amounts are before VAT (kept) or include it (taken out).
    const ownerNet = b.dir === "in" && ov.vat !== "asWritten" ? (ownerNetIn(g, b) ?? (ov.ownerNet ? "on another sheet of this workbook" : null)) : null;
    if (vatPairs.length && (ov.vat === "net" || ownerNet)) {
      // The owner's own definition: sales are the amounts less the VAT beside them.
      b.vatMode = "owner-net";
      for (const x of blockLines) if (x.vat !== null) x.line.amount = round2(x.written - x.vat);
      checks.push({ message: `${sheet}: sales are read as the amount less the VAT in column ${colLetter(b.vat! + origin.c)}, ${ownerNet ? `as your own formula ${ownerNet.startsWith("=") ? ownerNet : `(${ownerNet})`} works them out` : "as you chose"}.` });
    } else if (vatPairs.length && ov.vat !== "asWritten") {
      const ratios = vatPairs.filter((p) => p.amount > 0 && p.vat > 0).map((p) => p.vat / p.amount).sort((x, y) => x - y);
      const rates = [0.14, 0.05, 0.1, 0.15];
      const excl = (x: number) => rates.some((t) => Math.abs(x - t) < 0.006);
      const incl = (x: number) => rates.some((t) => Math.abs(x - t / (1 + t)) < 0.004);
      const nEx = ratios.filter(excl).length, nIn = ratios.filter(incl).length;
      b.vatMode = nIn > nEx && nEx === 0 ? "included" : nIn > 0 && nEx > 0 ? "mixed" : "excluded";
      const side = b.dir === "out" ? "costs" : "sales";
      const vc = colLetter(b.vat! + origin.c);
      if (b.vatMode === "included") {
        for (const x of blockLines) if (x.vat !== null) x.line.amount = round2(x.written - x.vat);
        checks.push({ message: `${sheet}: the ${side} amounts include VAT (column ${vc} is about ${Math.round((ratios[Math.floor(ratios.length / 2)] ?? 0) * 1000) / 10}% of them), so the VAT was taken out.` });
      } else if (b.vatMode === "mixed") {
        checks.push({ message: `${sheet}: VAT in column ${vc} is about 14% of some ${side} amounts and about 12.3% of others, as if some amounts include VAT and some do not. The amounts are used as written: check the rows with VAT.` });
      }
    }
  }

  // Columns with figures that are not read as amounts are named (a dropped column is never silent).
  for (const b of blocks) {
    const used = new Set([b.label, b.date, b.vat, b.product, b.channel, ...b.amounts.map((a) => a.col)]);
    for (let c = b.c0; c <= b.c1; c++) {
      if (used.has(c)) continue;
      const nums = rows.slice(headerRow + 1).filter((row, i) => isNum(row?.[c]) && !formulaAt(headerRow + 1 + i, c)).length;
      if (nums >= 2) checks.push({ col: c, message: `${sheet}, column ${colLetter(c + origin.c)} ("${str(rows[headerRow]?.[c]) || "no heading"}"): ${nums} figures that are not read as amounts, because the column is mostly words. If they are amounts, change the words in it.` });
    }
  }

  // ---- the person's totals, checked: formulas whose cells are entries iReport read (or other totals).
  const controls = checkFormulas();
  if (outsideHeading.length) checks.push({ row: outsideHeading[0], message: `${outsideHeading.length} entr${outsideHeading.length === 1 ? "y is" : "ies are"} dated outside the month heading above ${outsideHeading.length === 1 ? "it" : "them"} (first: ${cellRef(outsideHeading[0], undefined, origin)}). ${byHeading ? "Counted in the heading's month, as you grouped them." : "Counted in the month of the date, as you chose."}` });

  if (!sales.length && !expenses.length && !errors.length) return null;

  const trace: Marks = [];
  rows.forEach((row, r) => {
    if (!row || row.every(blank)) return;
    const ms = marks[r];
    if (!ms?.length) { trace[r] = r === headerRow ? { role: "header" } : r < headerRow ? { role: "title" } : { role: "unused", note: "nothing to read on this row" }; return; }
    const pick = ms.find((m) => m.role === "error") ?? ms.find((m) => m.role === "entry") ?? ms.find((m) => m.role === "total") ?? ms.find((m) => m.role === "heading") ?? ms[0];
    trace[r] = { ...pick, note: [...new Set(ms.map((m) => m.note).filter(Boolean))].join(" · ") || pick.note };
  });
  for (const s of ov.skipRows ?? []) if (s >= 0 && s < g.rows.length) trace[s] = { role: "skipped", note: "left out by you" };
  for (const c of controls) if (!c.ok && !c.derived) trace[c.row] = { role: "error", note: "your total does not match the entries" };
  const cellErrors: CellError[] = errors.map((e) => ({ sheet, row: e.row, col: e.col, text: e.text, message: `${cellRef(e.row, e.col, origin)}: ${e.message}` }));
  const salesOn = !ov.salesOff;
  const sum = (ls: { amount: number }[]) => round2(ls.reduce((a, l) => a + l.amount, 0));
  const layout: CashLayout = {
    sheet, kind: "cashbook", headerRow, blocks, controls, trace, errors: cellErrors, checks, salesOn, twice,
    out: { lines: expenses.length, total: sum(expenses) }, in: { lines: sales.length, total: sum(sales) },
  };
  return { sales: salesOn ? sales : [], expenses, layout };

  /** A typed total ("Total" with figures, no formula): each figure must equal its column's entries since the last total. */
  function typedTotal(r: number, b: CashBlock) {
    const row = rows[r] ?? [];
    for (const c of [...b.amounts.map((a) => a.col), ...(b.vat !== null ? [b.vat] : [])]) {
      if (amt(row[c]) === null) continue;
      let since = 0, all = 0;
      let seenTotal = false;
      for (let rr = r - 1; rr > headerRow; rr--) {
        const v = counted.get(key(rr, c));
        if (TOTAL_ROW.test(head(rows[rr]?.[b.label]))) seenTotal = true;
        if (v !== undefined) { all += v; if (!seenTotal) since += v; }
      }
      const file = amt(row[c])!;
      const ok = Math.abs(since - file) <= 0.5 || Math.abs(all - file) <= 0.5;
      typed.push({ row: r, col: c, formula: "typed total", file, read: round2(Math.abs(since - file) <= 0.5 ? since : all), ok, derived: false });
    }
  }

  function checkFormulas(): CashControl[] {
    const amountCol = new Set<number>(blocks.flatMap((b) => [...b.amounts.map((a) => a.col), ...(b.vat !== null ? [b.vat] : [])]));
    const out: CashControl[] = [...typed];
    const memo = new Map<string, number | null>();
    const covered = new Map<string, string[]>();
    // A total's value from what iReport read: entries it counted, other totals (worked out the same way), and
    // nothing else. Null when it uses cells outside the amount columns that are not totals (the person's own sums).
    const value = (r: number, c: number, seen: Set<string>): { v: number; direct: boolean; unread: number[] } | null => {
      const terms = sumTerms(formulaAt(r, c) ?? "", origin);
      if (!terms) return null;
      let v = 0, direct = false;
      const unread: number[] = [];
      for (const t of terms) for (let rr = t.r0; rr <= t.r1; rr++) for (let cc = t.c0; cc <= t.c1; cc++) {
        const k = key(rr, cc);
        if (counted.has(k)) { v += t.sign * counted.get(k)!; direct = true; continue; }
        const f = formulaAt(rr, cc);
        if (f) {
          if (seen.has(k)) return null;
          if (!memo.has(k)) { const sub = value(rr, cc, new Set([...seen, k])); memo.set(k, sub ? sub.v : null); if (sub) unread.push(...sub.unread); }
          const sv = memo.get(k);
          if (sv === null || sv === undefined) return null;
          v += t.sign * sv; continue;
        }
        const cell = rows[rr]?.[cc];
        if (amt(cell) === null) continue;
        if (!amountCol.has(cc)) return null;
        // A number inside the total that iReport did not count as an entry.
        unread.push(rr);
      }
      // A sum over the person's own summary rows (no entries in it) is theirs, not a total of entries.
      if (!direct && unread.length) return null;
      return { v: round2(v), direct, unread };
    };
    for (const [k, f] of Object.entries(g.formulas ?? {})) {
      const [r, c] = k.split(":").map(Number);
      if (formulaAt(r, c) === null || !multiRow(r, f)) continue;
      const res = value(r, c, new Set([k]));
      if (!res) continue;
      const file = amt(rows[r]?.[c]);
      if (file === null) continue;
      const terms = sumTerms(f, origin) as Term[];
      // Which entries this total counts (to find entries outside every total, and entries counted twice).
      if (res.direct) for (const t of terms) for (let rr = t.r0; rr <= t.r1; rr++) for (let cc = t.c0; cc <= t.c1; cc++) if (counted.has(key(rr, cc))) (covered.get(key(rr, cc)) ?? covered.set(key(rr, cc), []).get(key(rr, cc))!).push(cellRef(r, c, origin).replace("row ", "").replace(", column ", ""));
      const ok = Math.abs(res.v - file) <= 0.5;
      out.push({ row: r, col: c, formula: `=${f}`, file, read: res.v, ok, derived: !res.direct });
      if (!ok && res.direct) {
        const why = res.unread.length ? ` ${[...new Set(res.unread)].slice(0, 4).map((x) => cellRef(x, undefined, origin)).join(", ")} ${res.unread.length > 1 ? "hold numbers" : "holds a number"} iReport did not count as ${res.unread.length > 1 ? "entries" : "an entry"} (see why on the left).` : "";
        errors.push({ row: r, col: c, text: shown(rows[r]?.[c]), message: `your total ${fmt(file)} (=${f}) does not match the entries iReport read from ${terms.map((t) => termText(t, origin)).join(" + ")}: ${fmt(res.v)}.${why} Fix the entry, or leave this total row out if it is not a total of these rows.` });
      }
    }
    // "Net" worked out as amounts minus VAT, when the VAT is a share *of* the amounts (so they are before VAT already).
    for (const c of out) {
      if (!c.derived || !c.formula.includes("-")) continue;
      const terms = sumTerms(c.formula, origin) ?? [];
      const b = blocks.find((x) => x.vat !== null && x.vatMode === "excluded" && terms.some((t) => t.sign === -1 && t.c0 === x.vat) && terms.some((t) => t.sign === 1 && x.amounts.some((a) => a.col === t.c0)));
      if (b) checks.push({ row: c.row, col: c.col, message: `${cellRef(c.row, c.col, origin)}: your figure ${c.formula} takes the VAT in column ${colLetter(b.vat! + origin.c)} away from the amounts, but that VAT is about 14% of each amount, so the amounts are already before VAT. iReport uses the amounts as written; by that reading your net figure is ${fmt(round2(terms.filter((t) => t.sign === -1).reduce((a, t) => a + (amt(rows[t.r0]?.[t.c0]) ?? 0), 0)))} too low.` });
    }
    for (const t of out.filter((x) => x.formula === "typed total" && !x.ok)) {
      errors.push({ row: t.row, col: t.col, text: shown(rows[t.row]?.[t.col]), message: `your total ${fmt(t.file)} does not match the entries above it (${fmt(t.read)}). Fix the entry, or leave this total row out if it is not a total of these rows.` });
    }
    // Entries outside every total of their column (when the column has totals), and entries counted in two totals.
    const byCol = new Map<number, { rows: number[]; sum: number }>();
    for (const [k, v] of counted) {
      const [r, c] = k.split(":").map(Number);
      const hasTotals = out.some((x) => x.col === c && x.formula !== "typed total" && !x.derived);
      if (!hasTotals) continue;
      const cov = covered.get(k) ?? [];
      if (!cov.length) { const e = byCol.get(c) ?? { rows: [], sum: 0 }; e.rows.push(r); e.sum += v; byCol.set(c, e); }
      else if (cov.length > 1) {
        const b = blocks.find((x) => x.c0 <= c && c <= x.c1);
        const line = (b?.dir === "out" ? expenses : sales).find((l) => l.src?.row === r);
        // effect: iReport's figure minus the owner's (VAT counted twice lowers their net sales; an amount counted twice raises their total).
        if (b && line && !(c === b.vat && b.dir === "out")) twice.push({ row: r, col: c, period: line.period, side: b.dir === "out" ? "expenses" : "sales", vat: c === b.vat, effect: (cov.length - 1) * v * (c === b.vat ? 1 : -1) });
        checks.push({ row: r, col: c, message: `${cellRef(r, c, origin)} (${fmt(v)}) is counted in ${cov.length} of your totals (${cov.join(", ")}): your sheet adds it twice. iReport counts it once.` });
      }
    }
    for (const [c, e] of byCol) {
      const rs = e.rows.sort((a, b) => a - b);
      const runs: string[] = [];
      let s = rs[0], p = rs[0];
      for (const r of rs.slice(1).concat([Infinity])) { if (r !== p + 1 && !rowsBetweenEmpty(p, r, c)) { runs.push(s === p ? `${s + 1 + origin.r}` : `${s + 1 + origin.r}–${p + 1 + origin.r}`); s = r; } p = r; }
      checks.push({ row: rs[0], col: c, message: `${sheet}, column ${colLetter(c + origin.c)}: rows ${runs.slice(0, 4).join(", ")}${runs.length > 4 ? "…" : ""} (${fmt(round2(e.sum))}) are not in any of your totals for this column. iReport counts them.` });
    }
    return out;
  }
  /** Rows between two entries hold nothing in this column (so the entries count as one run). */
  function rowsBetweenEmpty(a: number, b: number, c: number) { if (!Number.isFinite(b)) return false; for (let r = a + 1; r < b; r++) if (counted.has(key(r, c))) return false; return b - a < 40; }
}

/** The kinds of cost a P&L line from a cash book can be (P&L cost classes only). */
export const CASH_COST_CLASSES: ClassKey[] = ["cos_variable", "cos_fixed", "exp_variable", "exp_fixed", "other_expenses", "interest_expenses", "tax_expenses"];

/** Each money-out column of the cash books, with the class iReport suggests for it. */
export function cashCostColumns(expenses: ExpenseLine[]): { name: string; cls: ClassKey; total: number }[] {
  const by = new Map<string, { cls: ClassKey; total: number }>();
  for (const l of expenses) {
    const e = by.get(l.account) ?? { cls: l.cls && CASH_COST_CLASSES.includes(l.cls) ? l.cls : "exp_variable", total: 0 };
    e.total = round2(e.total + l.amount);
    by.set(l.account, e);
  }
  return [...by].map(([name, e]) => ({ name, ...e }));
}

/**
 * A cash-basis P&L from cash books: money in as revenue, each money-out column as one cost account (classed as the
 * person confirms). Built from the very lines saved to Sales and Expenses, so every sector shows the same figures.
 * Amounts are in their natural sign (revenue and costs positive), as an accounts import sends them.
 */
export function cashAccounts(sales: SalesLine[], expenses: ExpenseLine[], map: Record<string, ClassKey> = {}) {
  const out: { code: string; name: string; cls: ClassKey; amounts: Record<string, number>; confidence: number; mapped_by: "auto" | "user"; ref?: { sheet: string; row: number; label: string } }[] = [];
  const add = (name: string, cls: ClassKey, ls: { period: string; amount: number; src?: { sheet: string; row: number } }[], user: boolean) => {
    const amounts: Record<string, number> = {};
    for (const l of ls) amounts[l.period] = round2((amounts[l.period] ?? 0) + l.amount);
    for (const [p, v] of Object.entries(amounts)) if (!v) delete amounts[p];
    if (!Object.keys(amounts).length) return;
    const src = ls.find((l) => l.src)?.src;
    out.push({ code: "", name: name.slice(0, 300), cls, amounts, confidence: 1, mapped_by: user ? "user" : "auto", ...(src ? { ref: { sheet: src.sheet.slice(0, 120), row: src.row, label: name.slice(0, 300) } } : {}) });
  };
  add("Sales (cash book)", "revenue", sales, false);
  for (const c of cashCostColumns(expenses)) add(c.name, map[c.name] ?? c.cls, expenses.filter((l) => l.account === c.name), c.name in map);
  return out;
}

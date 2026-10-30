import { tied } from "@/lib/tolerance";
import { arRx, cleanNum, detectDateOrder, normAr, parseDay, type Cell, type DateOrder } from "./parse";
import { str, type Grid } from "./extract";
import { applyFixes, cellRef, shown, type CellError, type Fixes, type Marks } from "./trace";
import { NO_SUPPLIER, type ExpenseLine } from "./expenses";
import { NO_CATEGORY, type SalesLine } from "./sales";
import { detectKind, isTradingKind } from "@/lib/cash/kinds";
import type { HeldBack } from "./cashbook";

/**
 * A bank statement: date, description, money out, money in, and the balance after each line. The balance is the
 * check: every line's balance must follow from the one before it (or from the opening balance), so a missing line or a
 * misread amount shows at the row where the balance breaks. Payments and receipts are added to expenses or sales only
 * when the person asks (a statement also holds transfers, loans and owner money, which are neither).
 */
export interface BankLayout {
  sheet: string;
  kind: "bank";
  headerRow: number;
  cols: { date: number; desc: number; debit: number | null; credit: number | null; amount: number | null; balance: number };
  dateOrder: DateOrder;
  /** Oldest line first, or newest first (balances are then checked from the bottom up). */
  newestFirst: boolean;
  opening: number | null;
  closing: number | null;
  moneyIn: { lines: number; total: number };
  moneyOut: { lines: number; total: number };
  /** Lines whose balance follows from the one before (all of them, when the statement is complete and read right). */
  balanced: number;
  trace: Marks;
  errors: CellError[];
  checks: { row?: number; col?: number; message: string }[];
  /** Lines left out of sales or costs when they were counted: loans, owner money, transfers, drawings. */
  heldBack?: HeldBack[];
  outAsExpenses: boolean;
  inAsSales: boolean;
}
export interface BankOverride extends Fixes { outAsExpenses?: boolean; inAsSales?: boolean }

const DATE = arRx(/^(date|value date|posting date|transaction date|trans\.? date|booking date|txn date|التاريخ|تاريخ|تاريخ الحركة|تاريخ القيد|تاريخ العملية|تاريخ الاستحقاق)$/i);
const DESC = arRx(/^(description|details|narrative|narration|particulars|transaction details|transaction|remarks|memo|البيان|الوصف|التفاصيل|بيان العملية)$/i);
const DEBIT = arRx(/^(debit|debits|dr|withdrawals?|money out|paid out|payments?|مدين|سحب|مسحوبات|خصم|منصرف)$/i);
const CREDIT = arRx(/^(credit|credits|cr|deposits?|money in|paid in|receipts?|دائن|إيداع|ايداع|إيداعات|ايداعات|إضافة|وارد)$/i);
const AMOUNT = arRx(/^(amount|transaction amount|المبلغ|القيمة)$/i);
const BALANCE = arRx(/^(balance|running balance|ledger balance|book balance|available balance|الرصيد|رصيد)$/i);
const ACCOUNT = arRx(/^(account|account code|account name|code|الحساب|كود الحساب|اسم الحساب|رقم الحساب)$/i);
const OPENING = arRx(/^(opening balance|balance brought forward|brought forward|b\/f|previous balance|balance b\/f|رصيد افتتاحي|الرصيد الافتتاحي|رصيد سابق|رصيد أول المدة|رصيد مرحل)/i);
const CLOSING = arRx(/^(closing balance|balance carried forward|carried forward|c\/f|balance c\/f|total|totals|الرصيد الختامي|رصيد آخر المدة|الإجمالي|الاجمالي|إجمالي)/i);

const blank = (v: Cell) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const amt = (v: Cell): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && !/[A-Za-zء-ي]/.test(v.replace(/\b(egp|usd|eur|cr|dr)\b|ج\.?م/gi, "")) ? cleanNum(v) : null);
const head = (v: Cell) => normAr(str(v).replace(/\s+/g, " ")).trim();
const round2 = (v: number) => Math.round(v * 100) / 100;
const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });

export function bankShape(rows: Cell[][]): { headerRow: number; cols: BankLayout["cols"] } | null {
  for (let h = 0; h < Math.min(rows.length, 20); h++) {
    const t = (rows[h] ?? []).map(head);
    const find = (rx: RegExp) => { const i = t.findIndex((x) => rx.test(x)); return i < 0 ? null : i; };
    const date = find(DATE), desc = find(DESC), balance = find(BALANCE), debit = find(DEBIT), credit = find(CREDIT), amount = find(AMOUNT);
    if (date === null || desc === null || balance === null) continue;
    if (!((debit !== null && credit !== null) || amount !== null)) continue;
    // A General Ledger has an account column, or account headings (no date) over its lines: the accounting reader's.
    if (t.some((x) => ACCOUNT.test(x))) return null;
    const first = rows.slice(h + 1).find((r) => r && r.some((v) => !blank(v)));
    if (first && !parseDay(first[date]) && !OPENING.test(head(first[desc])) && !(first as Cell[]).some((v) => v instanceof Date)) return null;
    return { headerRow: h, cols: { date, desc, debit: debit !== null && credit !== null ? debit : null, credit: debit !== null && credit !== null ? credit : null, amount: debit !== null && credit !== null ? null : amount, balance } };
  }
  return null;
}

export function readBankStatement(g: Grid, ov: BankOverride = {}): { sales: SalesLine[]; expenses: ExpenseLine[]; layout: BankLayout } | null {
  const rows = applyFixes(g.rows, ov);
  const shape = bankShape(rows);
  if (!shape) return null;
  const { headerRow, cols } = shape;
  const sheet = g.name, origin = g.origin ?? { r: 0, c: 0 };
  const order = detectDateOrder(rows.slice(headerRow + 1).map((r) => r?.[cols.date])).order ?? "dmy";
  const errors: { row: number; col: number; text: string; message: string }[] = [];
  const checks: BankLayout["checks"] = [];
  const marks: Marks = [];
  interface Tx { r: number; day: string; desc: string; out: number; in: number; bal: number | null }
  const txs: Tx[] = [];
  let opening: number | null = null, closing: number | null = null;
  const totalsRows: { r: number; out: number | null; in: number | null; bal: number | null }[] = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.every(blank)) continue;
    const desc = str(row[cols.desc]).replace(/\s+/g, " ");
    const bal = amt(row[cols.balance]);
    const money = (c: number | null) => {
      if (c === null || blank(row[c])) return 0;
      const v = amt(row[c]);
      if (v === null) { errors.push({ row: r, col: c, text: shown(row[c]), message: `"${shown(row[c])}" is not a number` }); return NaN; }
      return v;
    };
    let out = money(cols.debit), inn = money(cols.credit);
    if (cols.amount !== null) { const a = money(cols.amount); out = a < 0 ? -a : 0; inn = a > 0 ? a : 0; }
    if (Number.isNaN(out) || Number.isNaN(inn)) { marks[r] = { role: "error", note: "an amount cannot be read" }; continue; }
    const day = parseDay(row[cols.date], order);
    if (OPENING.test(head(desc)) && !out && !inn) { if (bal !== null) { opening = bal; } marks[r] = { role: "opening", note: "opening balance" }; continue; }
    if (CLOSING.test(head(desc)) && !day) { totalsRows.push({ r, out: out || null, in: inn || null, bal }); if (bal !== null) closing = bal; marks[r] = { role: "total", note: "your totals, checked below" }; continue; }
    if (!out && !inn) {
      if (!day && bal !== null && !txs.length && opening === null) { opening = bal; marks[r] = { role: "opening", note: "opening balance" }; continue; }
      marks[r] = { role: "unused", note: day ? "no amount on this line" : "a note, not a line" };
      continue;
    }
    if (!day) { errors.push({ row: r, col: cols.date, text: shown(row[cols.date]), message: str(row[cols.date]) ? `"${shown(row[cols.date])}" is not a date` : "no date on this line" }); marks[r] = { role: "error", note: "no date" }; continue; }
    txs.push({ r, day, desc, out, in: inn, bal });
    marks[r] = { role: "entry", note: [out ? `out ${fmt(out)}` : "", inn ? `in ${fmt(inn)}` : ""].filter(Boolean).join(" · ") };
  }
  if (!txs.length && !errors.length) return null;

  // Oldest first or newest first, and which way the balance moves: whichever makes the most balances follow.
  const follows = (seq: Tx[], start: number | null, sign: 1 | -1) => {
    let prev = start, n = 0;
    for (const t of seq) { if (t.bal === null) { if (prev !== null) prev += sign * (t.in - t.out); continue; } if (prev !== null && Math.abs(prev + sign * (t.in - t.out) - t.bal) <= 0.5) n++; prev = t.bal; }
    return n;
  };
  const datesDown = txs.length > 1 && txs[0].day > txs[txs.length - 1].day;
  const seqOld = datesDown ? [...txs].reverse() : txs;
  const sign: 1 | -1 = follows(seqOld, opening, 1) >= follows(seqOld, opening, -1) ? 1 : -1;
  // Each line's balance must follow from the last known one; the first line with a balance and no opening sets it.
  let prev: number | null = datesDown ? null : opening;
  let balanced = 0;
  for (const t of seqOld) {
    if (t.bal === null) { if (prev !== null) prev = round2(prev + sign * (t.in - t.out)); continue; }
    if (prev === null) { prev = t.bal; balanced++; continue; }
    const want = round2(prev + sign * (t.in - t.out));
    if (tied(want, t.bal)) balanced++;
    else {
      errors.push({ row: t.r, col: cols.balance, text: shown(rows[t.r]?.[cols.balance]), message: `the balance ${fmt(t.bal)} does not follow from the line before: ${fmt(prev)}${t.in ? ` + ${fmt(t.in)} in` : ""}${t.out ? ` − ${fmt(t.out)} out` : ""} = ${fmt(want)}. A line may be missing above, or an amount is misread.` });
      marks[t.r] = { role: "error", note: "the balance does not follow" };
    }
    prev = t.bal;
  }
  const sum = (k: "in" | "out") => round2(txs.reduce((a, t) => a + t[k], 0));
  for (const tr of totalsRows) {
    for (const [k, c] of [["out", cols.debit], ["in", cols.credit]] as const) {
      const v = tr[k];
      if (v === null || c === null) continue;
      if (Math.abs(v - sum(k)) > 0.5) errors.push({ row: tr.r, col: c, text: shown(rows[tr.r]?.[c]), message: `your total ${fmt(v)} does not match the lines (${fmt(sum(k))}).` });
    }
    if (tr.bal !== null && opening !== null && Math.abs(tr.bal - round2(opening + sign * (sum("in") - sum("out")))) > 0.5) {
      errors.push({ row: tr.r, col: cols.balance, text: shown(rows[tr.r]?.[cols.balance]), message: `the closing balance ${fmt(tr.bal)} does not follow from the opening ${fmt(opening)} and the lines (${fmt(round2(opening + sign * (sum("in") - sum("out"))))}).` });
    }
  }
  const outAsExpenses = !!ov.outAsExpenses, inAsSales = !!ov.inAsSales;
  // Counted as sales or costs only when trading: a loan, the owner's money, a transfer or drawings is left out (the cash book's kinds).
  const heldBack: HeldBack[] = [];
  const trading = (t: { r: number; desc: string; in: number; out: number }, d: "in" | "out") => {
    const kind = detectKind(d, t.desc);
    if (isTradingKind(kind)) return true;
    heldBack.push({ row: t.r, kind, amount: round2(d === "in" ? t.in : t.out), label: t.desc.slice(0, 120) });
    return false;
  };
  checks.push({ message: `${sheet}: a bank statement, ${txs.length} lines. Balances follow on ${balanced} of ${txs.filter((t) => t.bal !== null).length} lines. ${outAsExpenses || inAsSales ? `Counted: ${[outAsExpenses ? "money out as expenses" : "", inAsSales ? "money in as sales" : ""].filter(Boolean).join(", ")}.` : "Not added to sales or expenses: a statement also holds transfers, loans and owner money. Tick the boxes beside the sheet to count them."}` });
  const expenses: ExpenseLine[] = outAsExpenses ? txs.filter((t) => t.out && trading(t, "out")).map((t) => ({ day: t.day, period: t.day.slice(0, 7), doc: "", series: "", supplier: NO_SUPPLIER, account: "Bank payments", cls: null, category: "Bank payments", label: t.desc.slice(0, 200) || "No description", amount: round2(t.out), src: { sheet, row: t.r } })) : [];
  const sales: SalesLine[] = inAsSales ? txs.filter((t) => t.in && trading(t, "in")).map((t) => ({ day: t.day, period: t.day.slice(0, 7), doc: "", series: "", customer: t.desc.slice(0, 80) || "No description", product: "Bank receipts", category: NO_CATEGORY, salesperson: "", qty: null, amount: round2(t.in), cost: null, src: { sheet, row: t.r } })) : [];
  const trace: Marks = [];
  rows.forEach((row, r) => { if (row && !row.every(blank)) trace[r] = marks[r] ?? (r === headerRow ? { role: "header" } : r < headerRow ? { role: "title" } : { role: "unused", note: "nothing to read on this row" }); });
  for (const s of ov.skipRows ?? []) if (s >= 0 && s < g.rows.length) trace[s] = { role: "skipped", note: "left out by you" };
  const layout: BankLayout = {
    sheet, kind: "bank", headerRow, cols, dateOrder: order, newestFirst: datesDown, opening, closing: closing ?? txs.filter((t) => t.bal !== null).at(datesDown ? 0 : -1)?.bal ?? null,
    moneyIn: { lines: txs.filter((t) => t.in).length, total: sum("in") }, moneyOut: { lines: txs.filter((t) => t.out).length, total: sum("out") },
    ...(heldBack.length ? { heldBack: heldBack.sort((a, b) => a.row - b.row) } : {}), balanced, trace, errors: errors.map((e) => ({ sheet, row: e.row, col: e.col, text: e.text, message: `${cellRef(e.row, e.col, origin)}: ${e.message}` })), checks, outAsExpenses, inAsSales,
  };
  return { sales, expenses, layout };
}

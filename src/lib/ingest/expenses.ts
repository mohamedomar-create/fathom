import type { ClassKey } from "@/lib/engine";
import { arRx, cleanNum, detectDateOrder, normAr, parseDay, parsePeriod, type Cell, type DateOrder, TOTAL_LABEL } from "./parse";
import { str, type Grid, type LedgerEntry } from "./extract";
import { applyFixes, badAmount, cellRef, shown, type CellError, type Fixes, type Marks } from "./trace";
import { checkExpenseTemplate, templateMarkOf } from "./template";
import { classify } from "./classify";
import { mostlyBills, VENDOR_HDR } from "./sales";
import { CARD_SPEND, COGS_SUPPLIER, CUSTOMER_DOCS, DEPRECIATION_SUPPLIER, GOV_PAYMENTS, EXPENSE_JOURNAL, LENDER_TAG, NO_SUPPLIER, UNNAMED_LENDER } from "@/lib/engine/expenses";
import { docKind, isBillDoc, seriesOf } from "@/lib/engine/series";

/**
 * Expense lines for the Expenses sector, from two places:
 *  - the cost-account move lines of an Odoo General Ledger (date, move, partner and label on every line);
 *  - a purchases export: Odoo's Invoice Analysis filtered to vendor bills, the Bills list, or iReport's expenses template.
 * Amounts are net of VAT in the company currency; refunds and supplier credit notes are negative.
 */
export interface ExpenseLine {
  day: string | null;
  period: string;
  doc: string;
  /** Where the line came from, from the document number: "BILL", "EXP", "STJ", a bank journal… */
  series: string;
  supplier: string;
  /** The account ("6101 Rent") or, in a file without accounts, the expense type. */
  account: string;
  cls: ClassKey | null;
  category: string;
  label: string;
  amount: number;
  /** Where the line was read (files only): the sheet and its row as uploaded. Never saved. */
  src?: { sheet: string; row: number };
}

export { COGS_SUPPLIER, CUSTOMER_DOCS, DEPRECIATION_SUPPLIER, EXPENSE_JOURNAL, NO_SUPPLIER } from "@/lib/engine/expenses";
/** P&L classes that are costs (dividends are a distribution, not an expense). */
export const EXPENSE_CLASSES = new Set<ClassKey>(["cos_variable", "cos_fixed", "cos_depreciation", "exp_variable", "exp_fixed", "exp_depreciation", "other_expenses", "interest_expenses", "tax_expenses", "adjustments"]);
const DEPRECIATION = new Set<ClassKey>(["cos_depreciation", "exp_depreciation"]);
const COST_OF_SALES = new Set<ClassKey>(["cos_variable", "cos_fixed"]);
/** Balance-sheet accounts that goods bought for stock pass through: a vendor bill on them is a purchase from that supplier. */
const STOCK_ACCOUNT = /stock interim|interim (received|delivered)|goods received|grni|inventory|stock|مخزون|بضاعة/i;
export const isStockAccount = (cls: ClassKey, name: string) => cls === "inventory" || cls === "wip" || ((cls === "other_cl" || cls === "other_ca") && STOCK_ACCOUNT.test(name));

/** Accounts that hold what banks charge: fees, commissions and charges (English and Arabic names). */
const BANK_COST = arRx(/bank\s*(charges?|fees?|commissions?|expenses?|costs?)|charges?\s*(&|and)\s*fees|(مصاريف|مصروفات|عمولات?|رسوم)\s*(بنكية|البنوك|بنك)/i);
/** Series that are not a bank journal: bills, invoices, stock, payroll, depreciation, exchange differences, journal entries. */
const NOT_BANK_SERIES = /^(R?BILL|R?EXP|R?PURCH?|PO|VB|VBILL|R?INV\d*|STJ|WH|STK|STOCK|STV|SVL|SV|MISC|ASSTE|SAL|SLIP|EXCH|CABA|POSS?|OPEN|OB)$/;
/** Odoo bank journal codes used by Egyptian banks, and the bank's name. Any other bank journal shows its own code. */
const BANKS: Record<string, string> = {
  CIB: "CIB", NBE: "National Bank of Egypt", BM: "Banque Misr", BMISR: "Banque Misr", MISR: "Banque Misr", AAIB: "AAIB", QNB: "QNB", HSBC: "HSBC",
  ADIB: "ADIB", ALEX: "Bank of Alexandria", BOA: "Bank of Alexandria", BDC: "Banque du Caire", SAIB: "SAIB", FAB: "First Abu Dhabi Bank", ENBD: "Emirates NBD",
  AUB: "Ahli United Bank", CAE: "Crédit Agricole Egypt", MASHREQ: "Mashreq", EGB: "EG Bank", HDB: "Housing & Development Bank", AIB: "Arab International Bank",
  ABK: "Al Ahli Bank of Kuwait", NBK: "NBK", UB: "The United Bank", ABC: "Bank ABC", CITI: "Citibank", AB: "Arab Bank", FAISAL: "Faisal Islamic Bank",
  // Not banks, but paid through one: the government payment gateway and the company credit cards. Their fees and card
  // interest sit with the banks; what they paid for keeps its own group (CHANNELS).
  CPS: "CPS (government payments)", VISA: "Company cards (VISA)",
};
/** Journals that are a way of paying, not a supplier: lines in them without a partner go to the group they stand for. */
const CHANNELS: Record<string, string> = { CPS: GOV_PAYMENTS, VISA: CARD_SPEND };

/**
 * The bank behind an interest or bank-charge line: the partner of a bill, else the bank journal the entry was booked in, else
 * the entry's partner; null when the line is neither interest nor a bank charge.
 */
export function lenderOf(e: Pick<LedgerEntry, "ref" | "partner">, cls: ClassKey, account: string): string | null {
  if (cls !== "interest_expenses" && !BANK_COST.test(normAr(account))) return null;
  if (docKind(e.ref) === "purchase" && e.partner) return LENDER_TAG + e.partner;
  const s = seriesOf(e.ref);
  if (s && !NOT_BANK_SERIES.test(s)) return LENDER_TAG + (BANKS[s] ?? s);
  return e.partner ? LENDER_TAG + e.partner : UNNAMED_LENDER;
}

/**
 * Who a cost line was paid to. Interest and bank charges go to their bank. Only a vendor bill or refund, or a purchase or
 * expense-journal entry, names a supplier: cost of sales from a stock move or a customer invoice carries the customer as
 * partner, and is grouped as cost of goods.
 */
export function supplierOf(e: Pick<LedgerEntry, "ref" | "label" | "partner">, cls: ClassKey, account = ""): string {
  if (DEPRECIATION.has(cls)) return DEPRECIATION_SUPPLIER;
  const lender = lenderOf(e, cls, account);
  if (lender) return lender;
  const kind = docKind(e.ref);
  if (kind === "purchase") return e.partner || NO_SUPPLIER;
  const channel = CHANNELS[seriesOf(e.ref)];
  if (channel) return e.partner || channel;
  if (kind === "stock" || (kind === "customer" && COST_OF_SALES.has(cls))) return COGS_SUPPLIER;
  if (kind === "customer") return CUSTOMER_DOCS;
  const journal = !e.label || e.label === e.ref || e.label === `Entry ${e.ref}` || /^MISC\b/i.test(seriesOf(e.ref));
  return journal ? EXPENSE_JOURNAL : NO_SUPPLIER;
}
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * The move lines of a General Ledger as expense lines. Lines must be mapped (the class decides what is a cost):
 *  - every line on a P&L cost account (its supplier from supplierOf);
 *  - vendor bills and refunds on the stock accounts goods are bought through (inventory, stock interim): purchases from that
 *    supplier, kept with their balance-sheet class so they show under suppliers but never in costs (they reach the P&L as
 *    cost of sales when the goods are sold).
 */
export function expensesFromLedger(lines: { code: string; name: string; cls: ClassKey | null; excluded: boolean; system?: boolean; entries?: LedgerEntry[] }[]): ExpenseLine[] {
  const out: ExpenseLine[] = [];
  for (const l of lines) {
    if (l.excluded || l.system || !l.cls || !l.entries) continue;
    const cost = EXPENSE_CLASSES.has(l.cls), stock = !cost && isStockAccount(l.cls, l.name);
    if (!cost && !stock) continue;
    const account = [l.code, l.name].filter(Boolean).join(" ");
    for (const e of l.entries) {
      if (!e.amount) continue;
      if (stock && !(isBillDoc(e.ref) && e.partner)) continue;
      const series = seriesOf(e.ref);
      const supplier = cost ? supplierOf(e, l.cls, account) : e.partner;
      out.push({ day: e.day, period: e.period, doc: e.ref, series, supplier, account, cls: l.cls, category: l.name || account, label: (e.label || "").replace(/\s+/g, " ").trim().slice(0, 200), amount: round2(e.amount) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- purchases exports

export type ExpenseField = "date" | "period" | "doc" | "supplier" | "account" | "category" | "label" | "untaxed" | "total";
const FIELD_RX: [ExpenseField, RegExp][] = [
  ["untaxed", arRx(/^(untaxed( total| amount)?|amount untaxed|total untaxed|tax excluded|subtotal|sub ?total|price subtotal|net( amount| total)?|المبلغ قبل الضريبة|الصافي|الإجمالي قبل الضريبة)$/i)],
  ["total", arRx(/^(total|amount|amount total|total amount|total in currency|total signed|value|الإجمالي|الاجمالي|القيمة|المبلغ|إجمالي)$/i)],
  ["date", arRx(/^(date|bill date|invoice date|accounting date|payment date|التاريخ|تاريخ الفاتورة|تاريخ فاتورة المورد|تاريخ)$/i)],
  ["period", arRx(/^(month|period|الشهر|الفترة)$/i)],
  ["doc", arRx(/^(number|bill( number| no\.?| reference| #)?|invoice( number| no\.?| #)?|reference|vendor reference|document|receipt( no\.?| number)?|رقم الفاتورة|الفاتورة|فاتورة المورد|رقم المستند|المرجع|رقم)$/i)],
  ["supplier", arRx(/^(vendor|vendors|supplier|suppliers|vendor name|supplier name|partner|payee|paid to|المورد|الموردين|اسم المورد|المورّد|الشريك|المستفيد)$/i)],
  ["account", arRx(/^(account|expense account|gl account|الحساب|اسم الحساب|حساب المصروف)$/i)],
  ["category", arRx(/^(product category|category|expense type|type|cost type|cost cent(er|re)|الفئة|التصنيف|نوع المصروف|البند|مركز التكلفة)$/i)],
  ["label", arRx(/^(product|description|label|item|details|narration|memo|البيان|الصنف|الوصف|المنتج)$/i)],
];
/** A heading's field; a required-mark "*" is ignored, and an amount "(excl. VAT)" is the amount before tax. */
export const expenseFieldOf = (h: string): ExpenseField | null => {
  const excl = /\((excl\.?|excluding|before|without) (vat|tax)\)/i.test(h);
  const t = normAr(h.replace(/\s*\*\s*$/, "").replace(/\s*\((excl\.?|excluding|before|without) (vat|tax)\)\s*$/i, "").replace(/\s+/g, " ").trim());
  const f = FIELD_RX.find(([, rx]) => rx.test(t))?.[0] ?? null;
  return f === "total" && excl ? "untaxed" : f;
};
const TOTAL_ROW = TOTAL_LABEL;
/** A General Ledger or Trial Balance has debit / credit columns: the accounting reader's, not a purchases list. */
const LEDGER_HDR = arRx(/^(debit|credit|balance|مدين|دائن|الرصيد)$/i);

export interface ExpenseLayout {
  sheet: string;
  kind: "list";
  headerRow: number;
  columns: { col: number; header: string; field: ExpenseField | null }[];
  dateOrder?: DateOrder;
  /** Only a tax-inclusive total was found. */
  taxIncluded: boolean;
  /** The amounts were negative overall (Odoo shows vendor bills as negative) and were turned positive. */
  flipped: boolean;
  lines: number;
  total: number;
  rowNo: number[];
  trace: Marks;
  errors: CellError[];
}
/** The person's corrections: what a column holds (by column index), retyped cells and rows left out (sheet as uploaded). */
export interface ExpenseOverride extends Fixes { cols?: Partial<Record<number, ExpenseField | null>> }

/** Reads a purchases export or the expenses template, or returns null when the sheet is not one. */
export function readExpenseGrid(g: Grid, ov: ExpenseOverride = {}): { lines: ExpenseLine[]; layout: ExpenseLayout } | null {
  const fixed = applyFixes(g.rows, ov);
  const rowNo: number[] = [];
  fixed.forEach((r, i) => { if (r && r.some((c) => str(c) !== "")) rowNo.push(i); });
  const rows = rowNo.map((i) => fixed[i]);
  const cols = ov.cols ?? {};
  const template = templateMarkOf(g) === "expenses";
  for (let r = 0; r < Math.min(rows.length, 25); r++) {
    const heads = rows[r].map((v) => str(v));
    if (heads.some((h) => LEDGER_HDR.test(normAr(h)))) return null;
    const fields = heads.map((h, c) => (c in cols ? cols[c] ?? null : expenseFieldOf(h)));
    const has = (f: ExpenseField) => fields.includes(f);
    if (!(has("untaxed") || has("total")) || !(has("date") || has("period")) || !(has("supplier") || has("account") || has("category") || has("label"))) continue;
    // Purchases, not sales: a vendor / supplier heading, mostly vendor-bill numbers, or iReport's expenses template.
    const vendor = template || heads.some((h) => VENDOR_HDR.test(normAr(h.replace(/\s*\*\s*$/, "")))) || mostlyBills(rows.slice(r + 1), fields.indexOf("doc"));
    if (!vendor) return null;
    return readList({ g, rows, rowNo, r, heads, marks: [], errors: [] }, fields, ov, template);
  }
  return null;
}

interface Ctx { g: Grid; rows: Cell[][]; rowNo: number[]; r: number; heads: string[]; marks: Marks; errors: { row: number; col: number; text: string; message: string }[] }

function readList(ctx: Ctx, fields: (ExpenseField | null)[], ov: ExpenseOverride, template: boolean) {
  const { g, rows, r, heads } = ctx;
  const sheet = g.name;
  const col = (f: ExpenseField) => fields.indexOf(f);
  const cAmt = col("untaxed") >= 0 ? col("untaxed") : col("total");
  const cDate = col("date"), cPer = col("period");
  const order = detectDateOrder(rows.slice(r + 1).map((x) => x[cDate])).order ?? "dmy";
  const lines: ExpenseLine[] = [];
  const text = (x: Cell[], f: ExpenseField) => (col(f) >= 0 ? str(x[col(f)]).replace(/\s+/g, " ") : "");
  const err = (i: number, c: number, message: string) => { ctx.errors.push({ row: i, col: c, text: shown(rows[i][c]), message }); ctx.marks[i] = { role: "error", note: message }; };
  const clsCache = new Map<string, ClassKey | null>();
  const clsOf = (t: string) => {
    if (!t) return null;
    if (!clsCache.has(t)) {
      // A bill on a stock account (inventory, stock interim) buys goods for stock: kept with its balance-sheet class, never a
      // cost (the P&L reading would call every name a running cost).
      const b = classify(t, "", "BS").cls;
      const c = b && isStockAccount(b, t) ? b : classify(t, "", "PL").cls;
      clsCache.set(t, c && (EXPENSE_CLASSES.has(c) || isStockAccount(c, t)) ? c : null);
    }
    return clsCache.get(t)!;
  };
  for (let i = r + 1; i < rows.length; i++) {
    const x = rows[i];
    const first = str(x[0]);
    if (TOTAL_ROW.test(normAr(first)) && !text(x, "supplier") && !text(x, "label")) { ctx.marks[i] = { role: "total", note: "iReport works out totals itself" }; continue; }
    const amount = cleanNum(x[cAmt]);
    if (amount === null) {
      if (badAmount(x[cAmt], amount)) err(i, cAmt, `"${shown(x[cAmt])}" is not a number`);
      else ctx.marks[i] = { role: "unused", note: `no amount in "${heads[cAmt]}"` };
      continue;
    }
    if (amount === 0) { ctx.marks[i] = { role: "unused", note: "the amount is 0" }; continue; }
    const day = cDate >= 0 ? parseDay(x[cDate], order) : null;
    const period = day?.slice(0, 7) ?? (cDate >= 0 ? parsePeriod(x[cDate], order) : null) ?? (cPer >= 0 ? parsePeriod(x[cPer]) : null);
    if (!period) {
      const c = cDate >= 0 ? cDate : cPer;
      err(i, c, str(x[c]) ? `"${shown(x[c])}" is not a date` : `no ${cDate >= 0 ? "bill date" : "month"} on this line`);
      continue;
    }
    const doc = text(x, "doc");
    const account = text(x, "account"), category = text(x, "category"), label = text(x, "label");
    const what = account || category || label;
    if (!ctx.marks[i]) ctx.marks[i] = { role: "entry" };
    lines.push({
      day, period, doc, series: seriesOf(doc), supplier: text(x, "supplier") || NO_SUPPLIER,
      account: what || "No account", cls: clsOf(account.replace(/^[\d.\-\s]+/, "") || category || label), category: category || account.replace(/^[\d.\-\s]+/, "") || label || "No category",
      label: label.slice(0, 200), amount: round2(amount), src: { sheet, row: ctx.rowNo[i] },
    });
  }
  // Odoo shows vendor bills as negative amounts (money going out): turned positive, refunds stay the other way.
  const sum = lines.reduce((s, l) => s + l.amount, 0);
  const flipped = sum < 0;
  if (flipped) for (const l of lines) l.amount = round2(-l.amount);
  if (!lines.length && !ctx.errors.length) return null;
  const { rowNo } = ctx;
  const trace: Marks = [];
  rowNo.forEach((orig, i) => { trace[orig] = ctx.marks[i] ?? (i === r ? { role: "header" } : i < r ? { role: "title" } : { role: "unused", note: "nothing to read on this row" }); });
  for (const s of ov.skipRows ?? []) if (s >= 0 && s < g.rows.length) trace[s] = { role: "skipped", note: "left out by you" };
  const errors: CellError[] = ctx.errors.map((e) => { const row = rowNo[e.row] ?? e.row; return { sheet, row, col: e.col, text: e.text, message: `${cellRef(row, e.col, g.origin)}: ${e.message}` }; });
  if (template) {
    for (const p of checkExpenseTemplate({ ...g, rows: applyFixes(g.rows, ov) })) {
      if (p.r === undefined || errors.some((e) => e.row === p.r && e.col === p.c)) continue;
      errors.push({ sheet, row: p.r, col: p.c ?? 0, text: p.text ?? "", message: `${cellRef(p.r, p.c, g.origin)}: ${p.message}` });
      trace[p.r] = { role: "error", note: p.message };
    }
  }
  const layout: ExpenseLayout = {
    sheet, kind: "list", headerRow: r, columns: heads.map((h, c) => ({ col: c, header: h, field: fields[c] })), dateOrder: cDate >= 0 ? order : undefined,
    taxIncluded: col("untaxed") < 0, flipped, lines: lines.length, total: round2(lines.reduce((s, l) => s + l.amount, 0)), rowNo, trace, errors,
  };
  return { lines, layout };
}

/** Months a set of expense lines covers. */
export const expensePeriods = (lines: ExpenseLine[]) => [...new Set(lines.map((l) => l.period))].sort();

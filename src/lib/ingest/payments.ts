// Odoo's payments list (Accounting ▸ Customers ▸ Payments and Vendors ▸ Payments, exported from the list view): one row per
// payment with its journal, partner, amount signed in the company's currency (positive received, negative paid) and state.
// Posted payments are read; drafts and cancelled ones are left out and named; every row is accounted for.
import { arRx, cleanNum, detectDateOrder, normAr, parseStampDay, type Cell } from "./parse";
import type { Grid } from "./extract";

export type PaymentState = "paid" | "in_process";
export interface PaymentLine {
  day: string; period: string; number: string; journal: string; method: string; partner: string;
  direction: "in" | "out";
  /** In the company's currency, signed: positive received, negative paid. */
  amount: number;
  currency: string; amountCurrency: number; state: PaymentState; row: number;
}
export interface PaymentFinding { id: "left_out" | "in_process" | "no_partner"; message: string }
export interface PaymentsRead {
  lines: PaymentLine[];
  skipped: Partial<Record<"draft" | "cancelled", { count: number; amount: number }>>;
  errors: string[];
  findings: PaymentFinding[];
}

const COLS = {
  date: arRx(/^(date|payment date|التاريخ|تاريخ الدفع)$/i),
  number: arRx(/^(number|reference|name|الرقم|المرجع)$/i),
  journal: arRx(/^(journal|اليومية|دفتر اليومية)$/i),
  method: arRx(/^(payment method|طريقة الدفع)$/i),
  partner: arRx(/^(customer\/vendor|partner|customer|vendor|الشريك|العميل\/المورد|العميل|المورد)$/i),
  signed: arRx(/^(amount signed|المبلغ بالإشارة)$/i),
  currency: arRx(/^(currency|العملة)$/i),
  company: arRx(/^(amount company currency signed|amount in company currency|المبلغ بعملة الشركة)$/i),
  state: arRx(/^(state|status|الحالة)$/i),
};
const STATE: [RegExp, PaymentState | "draft" | "cancelled"][] = [
  [arRx(/^(paid|posted|reconciled|مدفوع|مرحل|مسوى)$/i), "paid"],
  [arRx(/^(in process|in payment|sent|قيد التنفيذ|قيد المعالجة|مرسل)$/i), "in_process"],
  [arRx(/^(draft|مسودة)$/i), "draft"],
  [arRx(/^(cancel+ed|rejected|ملغي|ملغى|مرفوض)$/i), "cancelled"],
];
const NOTES = /notes? receivable|checks?|cheques?|شيكات|أوراق قبض|اوراق قبض/i;

const text = (v: Cell) => (v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim());
const r2 = (n: number) => Math.round(n * 100) / 100 || 0;
const fmt = (n: number) => r2(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function readPayments(g: Grid): PaymentsRead | null {
  const rows = g.rows;
  let h = -1;
  const col: Partial<Record<keyof typeof COLS, number>> = {};
  for (let i = 0; i < Math.min(rows.length, 10) && h < 0; i++) {
    const cells = (rows[i] ?? []).map((c) => normAr(text(c)));
    const found: typeof col = {};
    for (const [k, rx] of Object.entries(COLS) as [keyof typeof COLS, RegExp][]) { const c = cells.findIndex((x) => rx.test(x)); if (c >= 0) found[k] = c; }
    if (found.date !== undefined && found.number !== undefined && found.journal !== undefined && found.partner !== undefined && (found.signed !== undefined || found.company !== undefined)) { h = i; Object.assign(col, found); }
  }
  if (h < 0) return null;
  const order = detectDateOrder(rows.slice(h + 1).map((r) => r?.[col.date!])).order ?? "dmy";
  const lines: PaymentLine[] = [];
  const skipped: PaymentsRead["skipped"] = {};
  const errors: string[] = [];
  const seen = new Map<string, number>();
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (!r.some((c) => text(c))) continue;
    const at = (k: keyof typeof COLS) => (col[k] === undefined ? null : r[col[k]!]);
    const number = text(at("number"));
    const amountCell = at("company") ?? at("signed");
    const amount = cleanNum(amountCell);
    if (amount === null) { errors.push(`Row ${i + 1}${number ? ` (${number})` : ""}: "${text(amountCell)}" is not an amount.`); continue; }
    const st = STATE.find(([rx]) => rx.test(normAr(text(at("state")))))?.[1] ?? "paid";
    if (st === "draft" || st === "cancelled") { const s = (skipped[st] ??= { count: 0, amount: 0 }); s.count++; s.amount = r2(s.amount + amount); continue; }
    const day = parseStampDay(at("date"), order, { date1904: g.date1904 });
    if (!day) { errors.push(`Row ${i + 1}${number ? ` (${number})` : ""}: "${text(at("date"))}" is not a date.`); continue; }
    if (number) {
      if (seen.has(number)) { errors.push(`Payment ${number} is listed twice (rows ${seen.get(number)! + 1} and ${i + 1}).`); continue; }
      seen.set(number, i);
    }
    const signed = cleanNum(at("signed"));
    lines.push({
      day, period: day.slice(0, 7), number, journal: text(at("journal")), method: text(at("method")), partner: text(at("partner")),
      direction: amount < 0 ? "out" : "in", amount: r2(amount), currency: text(at("currency")), amountCurrency: r2(signed ?? amount), state: st, row: i,
    });
  }
  const findings: PaymentFinding[] = [];
  const out = Object.entries(skipped);
  if (out.length) findings.push({ id: "left_out", message: `Left out, not posted: ${out.map(([k, v]) => `${v!.count} ${k} (${fmt(v!.amount)})`).join(", ")}.` });
  const notes = lines.filter((l) => l.state === "in_process");
  if (notes.length) {
    const cheques = notes.filter((l) => NOTES.test(`${l.journal} ${l.method}`));
    findings.push({ id: "in_process", message: `${notes.length} payment${notes.length > 1 ? "s are" : " is"} still in process (${fmt(notes.reduce((s, l) => s + l.amount, 0))})${cheques.length ? `, ${cheques.length} of them cheques or notes not yet cleared by the bank` : ""}: counted, but not cash yet.` });
  }
  const anon = lines.filter((l) => !l.partner);
  if (anon.length) findings.push({ id: "no_partner", message: `${anon.length} payment${anon.length > 1 ? "s have" : " has"} no customer or vendor (${fmt(anon.reduce((s, l) => s + l.amount, 0))}).` });
  return { lines, skipped, errors, findings };
}

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

// Labels as the list shows them, and the technical field names an import-compatible export uses.
const COLS = {
  date: arRx(/^(date|payment date|التاريخ|تاريخ الدفع)$/i),
  number: arRx(/^(number|reference|name|الرقم|المرجع)$/i),
  journal: arRx(/^(journal|journal_id|اليومية|دفتر اليومية)$/i),
  method: arRx(/^(payment method|payment_method_line_id|payment_method_id|طريقة الدفع)$/i),
  partner: arRx(/^(customer\/vendor|partner|partner_id|customer|vendor|الشريك|العميل\/المورد|العميل|المورد)$/i),
  signed: arRx(/^(amount signed|amount_signed|المبلغ بالإشارة)$/i),
  amount: arRx(/^(amount|المبلغ)$/i),
  ptype: arRx(/^(payment type|payment_type|نوع الدفع)$/i),
  currency: arRx(/^(currency|currency_id|العملة)$/i),
  company: arRx(/^(amount company currency signed|amount_company_currency_signed|amount in company currency|المبلغ بعملة الشركة)$/i),
  state: arRx(/^(state|status|الحالة)$/i),
};
type Col = keyof typeof COLS;
const RECEIVE = arRx(/^(receive|inbound|receive money|استلام|قبض|وارد)$/i);
const SEND = arRx(/^(send|outbound|send money|إرسال|ارسال|دفع|صادر)$/i);

/** Which field a heading is: the heading itself, or for an Export-dialog "Field/Sub-field" label ("Journal/Display Name")
 *  the field before the sub-field ("Customer/Vendor" keeps its own slash). */
function fieldOf(h: string): Col | null {
  let label = h;
  for (;;) {
    const hit = (Object.entries(COLS) as [Col, RegExp][]).find(([, rx]) => rx.test(label));
    if (hit) return hit[0];
    const cut = label.lastIndexOf("/");
    if (cut <= 0) return null;
    label = label.slice(0, cut).trim();
  }
}
function headingsAt(row: Cell[] | undefined): Partial<Record<Col, number>> {
  const found: Partial<Record<Col, number>> = {};
  (row ?? []).forEach((c, j) => { const k = fieldOf(normAr(text(c))); if (k && found[k] === undefined) found[k] = j; });
  return found;
}
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

const NEEDED: [string, (f: Partial<Record<Col, number>>) => boolean][] = [
  ["Date", (f) => f.date !== undefined], ["Number", (f) => f.number !== undefined], ["Journal", (f) => f.journal !== undefined],
  ["Customer/Vendor", (f) => f.partner !== undefined],
  ["Amount Signed or Amount Company Currency Signed, or Amount with Payment Type", (f) => f.signed !== undefined || f.company !== undefined || (f.amount !== undefined && f.ptype !== undefined)],
];

/** For a sheet readPayments did not read: the headings it lacks, when it has most of a payments list's headings; else null. */
export function paymentsHeadingGap(g: Grid): string | null {
  let best: string[] | null = null;
  for (let i = 0; i < Math.min(g.rows.length, 10); i++) {
    const found = headingsAt(g.rows[i]);
    const missing = NEEDED.filter(([, has]) => !has(found)).map(([name]) => name);
    if (missing.length <= 2 && (!best || missing.length < best.length)) best = missing;
  }
  return best && best.length ? `looks like a payments list but has no ${best.join(" or ")} heading` : null;
}

/** opts.currency: the company's currency, so an amount in another currency is never counted as if it were in it. */
export function readPayments(g: Grid, opts: { currency?: string } = {}): PaymentsRead | null {
  const rows = g.rows;
  let h = -1;
  const col: Partial<Record<Col, number>> = {};
  for (let i = 0; i < Math.min(rows.length, 10) && h < 0; i++) {
    const found = headingsAt(rows[i]);
    if (NEEDED.every(([, has]) => has(found))) { h = i; Object.assign(col, found); }
  }
  if (h < 0) return null;
  // Without Odoo's company-currency amount, the company's currency (else the file's usual one) is the only one counted.
  const curOf = (r: Cell[] | undefined) => (col.currency === undefined ? "" : text(r?.[col.currency]).toUpperCase());
  const counts = new Map<string, number>();
  for (const r of rows.slice(h + 1)) { const c = curOf(r); if (c) counts.set(c, (counts.get(c) ?? 0) + 1); }
  const home = (opts.currency || [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || "").toUpperCase();
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
    const amountCell = col.company !== undefined ? at("company") : col.signed !== undefined ? at("signed") : at("amount");
    const raw = cleanNum(amountCell);
    if (raw === null) { errors.push(`Row ${i + 1}${number ? ` (${number})` : ""}: "${text(amountCell)}" is not an amount.`); continue; }
    let amount = raw;
    if (col.company === undefined && col.signed === undefined) {
      const t = normAr(text(at("ptype")));
      if (RECEIVE.test(t)) amount = Math.abs(raw);
      else if (SEND.test(t)) amount = -Math.abs(raw);
      else { errors.push(`Row ${i + 1}${number ? ` (${number})` : ""}: payment type "${text(at("ptype"))}" is neither Receive nor Send.`); continue; }
    }
    const st = STATE.find(([rx]) => rx.test(normAr(text(at("state")))))?.[1] ?? "paid";
    if (st === "draft" || st === "cancelled") { const s = (skipped[st] ??= { count: 0, amount: 0 }); s.count++; s.amount = r2(s.amount + amount); continue; }
    const cur = curOf(r);
    if (col.company === undefined && cur && home && cur !== home) { errors.push(`Row ${i + 1}${number ? ` (${number})` : ""}: the amount is in ${cur}, not ${home}. Add "Amount in Company Currency" (Amount Company Currency Signed) to the export.`); continue; }
    const day = parseStampDay(at("date"), order, { date1904: g.date1904 });
    if (!day) { errors.push(`Row ${i + 1}${number ? ` (${number})` : ""}: "${text(at("date"))}" is not a date.`); continue; }
    if (number) {
      if (seen.has(number)) { errors.push(`Payment ${number} is listed twice (rows ${seen.get(number)! + 1} and ${i + 1}).`); continue; }
      seen.set(number, i);
    }
    const signed = col.signed !== undefined ? cleanNum(at("signed")) : col.amount !== undefined ? Math.sign(amount) * Math.abs(cleanNum(at("amount")) ?? 0) : null;
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

import { arRx, normAr, type Cell } from "./parse";
import { str } from "./extract";

/**
 * Columns read only for Simple-mode companies (a Sales and an Expenses sheet, no ERP): channel, paid or not, payment
 * date and fixed or variable. Full-mode reading never looks for them, so its results cannot change.
 */
export const CHANNEL_RX = arRx(/^(channel|sales channel|sale channel|source|platform|طريقة البيع|القناة|قناة البيع|المنصة)$/i);
export const PAID_RX = arRx(/^(paid\??|paid ?\/ ?unpaid|status|payment status|collected\??|مدفوع|مدفوعة|حالة الدفع|حالة السداد|تم الدفع|تم التحصيل)$/i);
export const PAID_ON_RX = arRx(/^(payment date|paid on|date paid|collection date|date collected|تاريخ السداد|تاريخ الدفع|تاريخ التحصيل)$/i);
export const FIXED_VAR_RX = arRx(/^(fixed ?(or|\/) ?variable|fixed ?\/ ?var|cost behaviou?r|ثابت أو متغير|ثابت ?\/ ?متغير|ثابت او متغير)$/i);

const norm = (h: string) => normAr(h.replace(/\s*\*\s*$/, "").replace(/\s+/g, " ").trim());
export const simpleFieldOf = (h: string): "channel" | "paid" | "paidOn" | "fixedVar" | null => {
  const t = norm(h);
  return PAID_ON_RX.test(t) ? "paidOn" : PAID_RX.test(t) ? "paid" : CHANNEL_RX.test(t) ? "channel" : FIXED_VAR_RX.test(t) ? "fixedVar" : null;
};

const YES = arRx(/^(yes|y|paid|true|1|done|collected|settled|✓|✔|نعم|مدفوع|مدفوعة|تم|تم الدفع|تم التحصيل|محصل)$/i);
const NO = arRx(/^(no|n|unpaid|not paid|false|0|due|pending|open|outstanding|لا|غير مدفوع|غير مدفوعة|لم يدفع|آجل|اجل|مستحق)$/i);
/** Paid (true), not paid (false), or not said (null). */
export function parsePaid(c: Cell): boolean | null {
  if (typeof c === "boolean") return c;
  const t = normAr(str(c).trim());
  return !t ? null : YES.test(t) ? true : NO.test(t) ? false : null;
}

const FIXED = arRx(/^(fixed|f|ثابت|ثابتة)$/i);
const VARIABLE = arRx(/^(variable|var|v|متغير|متغيرة)$/i);
/** A cost's behaviour as written in the sheet: fixed, variable, or not said. */
export function parseFixedVar(c: Cell): "exp_fixed" | "exp_variable" | null {
  const t = normAr(str(c).trim());
  return FIXED.test(t) ? "exp_fixed" : VARIABLE.test(t) ? "exp_variable" : null;
}

/** The key a column's heading is remembered by (case, spaces and Arabic spellings ignored). */
export const headingKey = (h: string) => normAr(h.replace(/\s*\*\s*$/, "").replace(/\s+/g, " ").trim()).toLowerCase();

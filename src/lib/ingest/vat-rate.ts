import type { LedgerEntry } from "./extract";

/** Egypt's standard VAT rate: the most a measured rate can be. */
const STANDARD = 0.14;
// A dedicated output (sales) VAT account; a net "VAT payable" account is used only when there is none.
const OUTPUT_VAT = /output\s*vat|vat\s*(on\s*)?(sales|output)|sales\s*vat|ضريب[ةه]\s*(ال)?قيم[ةه]\s*(ال)?مضاف[ةه].*(مبيعات|مخرجات)|ضريب[ةه]\s*(ال)?مبيعات/i;
const NET_VAT = /vat\s*payable|ضريب[ةه]\s*(ال)?قيم[ةه]\s*(ال)?مضاف[ةه]/i;
const INPUT_VAT = /input|purchase|receivable|مشتريات|مدخلات/i;
// Debits from the Tax Authority side (settlements), not customer credit notes.
const AUTHORITY = /tax\s*authority|\beta\b|مصلح[ةه]\s*(ال)?ضرائب|الضرائب/i;
const CREDIT_NOTE = /^R(INV|FAC)|credit\s*note|إشعار\s*دائن/i;
/** Output VAT sits under tax owed, or under other current liabilities when the classifier did not place it there. */
const VAT_CLASSES = new Set(["tax_liab", "other_cl"]);

export interface MeasuredVat { rate: number; outputVat: number; revenue: number; from: string; to: string }

const shift = (p: string, n: number) => { const d = new Date(Date.UTC(+p.slice(0, 4), +p.slice(5, 7) - 1 + n, 1)); return d.toISOString().slice(0, 7); };

/**
 * The VAT the business really charges: output VAT credited over the last 12 months of the ledger ÷ revenue, between
 * 0 and 14%. Many medical goods are exempt, so a flat 14% would understate customer days for such sellers. Debits on
 * the output VAT account (settlements with the Tax Authority, set-off against input VAT) are left out. Null when the
 * ledger has no output VAT account or no revenue: the company's own rate, or 14%, is used then.
 */
export function measureVat(lines: { name: string; cls: string | null; excluded: boolean; entries?: LedgerEntry[] }[]): MeasuredVat | null {
  const used = lines.filter((l) => !l.excluded && l.entries?.length);
  const vatLike = used.filter((l) => VAT_CLASSES.has(l.cls ?? "") && !INPUT_VAT.test(l.name));
  const dedicated = vatLike.filter((l) => OUTPUT_VAT.test(l.name));
  const vat = dedicated.length ? dedicated : vatLike.filter((l) => NET_VAT.test(l.name));
  const rev = used.filter((l) => l.cls === "revenue");
  if (!vat.length || !rev.length) return null;
  // The window ends at the last month with revenue, and starts at the first month it really holds within 12.
  const revEntries = rev.flatMap((l) => l.entries!);
  const to = revEntries.map((e) => e.period).sort().at(-1)!;
  const earliest = shift(to, -11);
  const from = revEntries.map((e) => e.period).filter((p) => p >= earliest).sort()[0];
  const inWindow = (e: LedgerEntry) => e.period >= from && e.period <= to;
  const revenue = -revEntries.filter(inWindow).reduce((s, e) => s + e.amount, 0);
  // Output VAT charged: credits, less the debits of customer credit notes (returns reduce revenue too). Settlements
  // with the Tax Authority and set-off against input VAT (no customer) are left out.
  const reversal = (e: LedgerEntry) => e.amount > 0 && (CREDIT_NOTE.test(e.ref) || (!!e.partner.trim() && !AUTHORITY.test(e.partner)));
  const outputVat = vat.flatMap((l) => l.entries!).filter(inWindow).reduce((s, e) => s + (e.amount < 0 ? -e.amount : reversal(e) ? -e.amount : 0), 0);
  if (!(revenue > 0)) return null;
  return { rate: Math.min(STANDARD, Math.max(0, outputVat / revenue)), outputVat, revenue, from, to };
}

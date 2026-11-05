import type { LedgerEntry } from "./extract";

/** Egypt's standard VAT rate: the most a measured rate can be. */
const STANDARD = 0.14;
const OUTPUT_VAT = /output\s*vat|vat\s*(on\s*)?(sales|output|payable)|sales\s*vat|ضريب[ةه]\s*(ال)?قيم[ةه]\s*(ال)?مضاف[ةه].*(مبيعات|مخرجات)|ضريب[ةه]\s*(ال)?مبيعات/i;
const INPUT_VAT = /input|purchase|مشتريات|مدخلات/i;

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
  const vat = used.filter((l) => l.cls === "tax_liab" && OUTPUT_VAT.test(l.name) && !INPUT_VAT.test(l.name));
  const rev = used.filter((l) => l.cls === "revenue");
  if (!vat.length || !rev.length) return null;
  const to = [...rev, ...vat].flatMap((l) => l.entries!.map((e) => e.period)).sort().at(-1)!;
  const from = shift(to, -11);
  const inWindow = (e: LedgerEntry) => e.period >= from && e.period <= to;
  const revenue = -rev.flatMap((l) => l.entries!).filter(inWindow).reduce((s, e) => s + e.amount, 0);
  const outputVat = vat.flatMap((l) => l.entries!).filter((e) => inWindow(e) && e.amount < 0).reduce((s, e) => s - e.amount, 0);
  if (!(revenue > 0)) return null;
  return { rate: Math.min(STANDARD, Math.max(0, outputVat / revenue)), outputVat, revenue, from, to };
}

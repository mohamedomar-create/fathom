// A plain list of open invoices or bills (customer or supplier, document, dates, amount still due), from any system,
// turned into the same ageing report the Payments module reads from Odoo's Aged Receivable / Payable. Age is counted
// from the due date at the as-of day (from the document date when the list has no due date).
import type { AgedFinding, AgedItem, AgedPartner, AgedReport } from "@/lib/ingest/aged";
import type { Rec } from "./records";

export const OPEN_BUCKETS = ["Not due", "1-30", "31-60", "61-90", "91-180", "181-365", "365+"];
const LIMITS = [0, 30, 60, 90, 180, 365];
const r2 = (n: number) => Math.round(n * 100) / 100 || 0;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const bucketOf = (late: number) => { if (late <= 0) return 0; const i = LIMITS.findIndex((l, k) => k > 0 && late <= l); return i < 0 ? LIMITS.length : i; };

export function openItemsReport(records: Rec[], side: "receivable" | "payable", asOf: string): AgedReport {
  const n = OPEN_BUCKETS.length;
  const items: AgedItem[] = [];
  const findings: AgedFinding[] = [];
  let noDate = 0, after = 0;
  for (const r of records) {
    const open = typeof r.open === "number" ? r.open : 0;
    if (!open) continue;
    const due = typeof r.due === "string" ? r.due : typeof r.date === "string" ? r.date : null;
    if (!due) noDate++;
    if (typeof r.date === "string" && r.date > asOf) after++;
    const amounts = Array(n).fill(0);
    amounts[due ? bucketOf(daysBetween(due, asOf)) : n - 1] = r2(open);
    items.push({ partner: String(r.party ?? "").trim() || "Unknown partner", ref: String(r.doc ?? ""), memo: "", day: typeof r.date === "string" ? r.date : null, amounts, total: r2(open), row: r.__row });
  }
  const byPartner = new Map<string, AgedPartner>();
  for (const it of items) {
    const p = byPartner.get(it.partner) ?? { name: it.partner, amounts: Array(n).fill(0), total: 0, items: 0 };
    p.amounts = p.amounts.map((a, i) => r2(a + it.amounts[i]));
    p.total = r2(p.total + it.total);
    p.items++;
    byPartner.set(it.partner, p);
  }
  const partners = [...byPartner.values()].sort((a, b) => b.total - a.total);
  const amounts = Array.from({ length: n }, (_, i) => r2(partners.reduce((s, p) => s + p.amounts[i], 0)));
  const total = r2(amounts.reduce((s, a) => s + a, 0));
  if (noDate) findings.push({ id: "date_order", message: `${noDate} open item${noDate > 1 ? "s have" : " has"} no due or document date: shown as the oldest.` });
  if (after) findings.push({ id: "after_as_of", message: `${after} document${after > 1 ? "s are" : " is"} dated after the as-of day ${asOf}.` });
  const credit = partners.filter((p) => p.total < 0);
  if (credit.length) findings.push({ id: "credit_balance", message: `${credit.length} ${side === "receivable" ? "customer" : "supplier"}${credit.length > 1 ? "s" : ""} in credit (${credit.slice(0, 3).map((p) => p.name).join(", ")}).` });
  return { side, asOf, buckets: [...OPEN_BUCKETS], partners, items, total: { amounts, total }, errors: [], findings };
}

/** An as-of day written above a list ("As of 31/10/2026", "حتى 31/10/2026"), else the latest document date. */
export function asOfOf(title: string | undefined, records: Rec[], parse: (s: string) => string | null): string | null {
  const m = title?.match(/(?:as of|as at|at|بتاريخ|حتى|في)\s*:?\s*([\d/.\-]+)/i);
  const day = m ? parse(m[1]) : null;
  if (day) return day;
  const days = records.map((r) => (typeof r.date === "string" ? r.date : null)).filter((d): d is string => !!d).sort();
  return days[days.length - 1] ?? null;
}

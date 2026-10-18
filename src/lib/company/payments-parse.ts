// The Payments summary as the database sends it (payments_summary, migration 0027), checked and typed.
import { EMPTY_PAYMENTS, type AgedData, type PaymentsData, type Side } from "@/lib/engine/payments";

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : 0);
const str = (v: unknown) => (typeof v === "string" ? v : "");

export function parsePaymentsSummary(raw: unknown): PaymentsData {
  if (!raw || typeof raw !== "object") return EMPTY_PAYMENTS;
  const r = raw as { aged?: Record<string, unknown>; payments?: unknown };
  const aged: Partial<Record<Side, AgedData>> = {};
  for (const side of ["receivable", "payable"] as Side[]) {
    const a = r.aged?.[side] as Record<string, unknown> | undefined;
    if (!a) continue;
    const buckets = Array.isArray(a.buckets) ? a.buckets.map(str) : [];
    const total = (a.total ?? {}) as { amounts?: unknown; total?: unknown };
    aged[side] = {
      asOf: str(a.as_of).slice(0, 10), buckets, filename: str(a.filename) || null,
      total: { amounts: Array.isArray(total.amounts) ? total.amounts.map(num) : buckets.map(() => 0), total: num(total.total) },
      findings: Array.isArray(a.findings) ? a.findings.map((f) => ({ id: str((f as { id?: unknown }).id), message: str((f as { message?: unknown }).message) })) : [],
      items: Array.isArray(a.items) ? a.items.map((i) => { const x = i as unknown[]; return { partner: str(x[0]), ref: str(x[1]), memo: str(x[2]), day: str(x[3]).slice(0, 10) || null, amounts: Array.isArray(x[4]) ? x[4].map(num) : [], total: num(x[5]) }; }) : [],
    };
  }
  const payments = Array.isArray(r.payments) ? r.payments.map((p) => {
    const x = p as unknown[];
    return { day: str(x[0]).slice(0, 10), number: str(x[1]), journal: str(x[2]), method: str(x[3]), partner: str(x[4]), amount: num(x[5]), currency: str(x[6]), amountCurrency: num(x[7]), state: str(x[8]) === "in_process" ? "in_process" as const : "paid" as const };
  }).filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.day)) : [];
  return { aged, payments };
}

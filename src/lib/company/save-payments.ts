"use client";
import { addPaymentLines, startPaymentBatch } from "@/app/company/[id]/settings/payments-actions";
import type { PaymentLine } from "@/lib/ingest/payments";

const CHUNK = 3000;

/** Saves payments from one source: that source's months are replaced first, then the lines in chunks. */
export async function savePayments(companyId: string, source: "file" | "ledger", lines: PaymentLine[], periods: string[], filename: string): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  const months = [...new Set([...periods, ...lines.map((l) => l.period)])].sort().slice(-240);
  if (!lines.length) return { ok: true, saved: 0 };
  const b = await startPaymentBatch(companyId, months, filename.slice(0, 300), source);
  if (!b.ok) return b;
  let saved = 0;
  for (let i = 0; i < lines.length; i += CHUNK) {
    const part = lines.slice(i, i + CHUNK).map((l) => ({ day: l.day, period: l.period, number: l.number, journal: l.journal, method: l.method, partner: l.partner, direction: l.direction, amount: l.amount, currency: l.currency, amount_currency: l.amountCurrency, state: l.state, ...(l.kind ? { kind: l.kind, counter: l.counter ?? "" } : {}) }));
    const r = await addPaymentLines(companyId, b.batch, part, i + CHUNK >= lines.length);
    if (!r.ok) return r;
    saved += r.saved;
  }
  return { ok: true, saved };
}

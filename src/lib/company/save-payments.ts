"use client";
import { addPaymentLines, startPaymentBatch } from "@/app/company/[id]/settings/payments-actions";
import type { PaymentLine } from "@/lib/ingest/payments";
import { ChunkStopped, orThrow, sendChunks, type ChunkOptions } from "@/lib/chunks";

/** Saves payments from one source: that source's months are replaced first, then the lines in chunks. */
export async function savePayments(companyId: string, source: "file" | "ledger", lines: PaymentLine[], periods: string[], filename: string, onProgress?: ChunkOptions["onProgress"]): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  const months = [...new Set([...periods, ...lines.map((l) => l.period)])].sort().slice(-240);
  if (!lines.length) return { ok: true, saved: 0 };
  const b = await startPaymentBatch(companyId, months, filename.slice(0, 300), source);
  if (!b.ok) return b;
  let saved = 0;
  const rows = lines.map((l) => ({ day: l.day, period: l.period, number: l.number, journal: l.journal, method: l.method, partner: l.partner, direction: l.direction, amount: l.amount, currency: l.currency, amount_currency: l.amountCurrency, state: l.state, ...(l.kind ? { kind: l.kind, counter: l.counter ?? "" } : {}) }));
  try {
    await sendChunks(rows, async (part, { last }) => { saved += (await orThrow(addPaymentLines(companyId, b.batch, part, last))).saved; }, { onProgress });
  } catch (e) {
    return { ok: false, error: e instanceof ChunkStopped ? e.message : String(e) };
  }
  return { ok: true, saved };
}

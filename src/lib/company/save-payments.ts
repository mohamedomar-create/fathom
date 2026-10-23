"use client";
import { addPaymentLines, finishPaymentBatch, startPaymentBatch } from "@/app/company/[id]/settings/payments-actions";
import type { PaymentLine } from "@/lib/ingest/payments";
import type { ChunkOptions } from "@/lib/chunks";
import { saveStaged } from "@/lib/company/save-lines";

/**
 * Saves payments from one source as one staged save: that source's payments in `periods` (and the lines' own months)
 * are replaced at the finish, even when no new line falls in them, so a re-upload never leaves old payments behind.
 * `all` replaces every month of the source.
 */
export async function savePayments(companyId: string, source: "file" | "ledger", lines: PaymentLine[], periods: string[], filename: string, onProgress?: ChunkOptions["onProgress"], opts: { all?: boolean } = {}): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  const months = [...new Set([...periods, ...lines.map((l) => l.period)])].sort();
  if (!months.length && !opts.all) return { ok: true, saved: 0 };
  if (months.length > 600) return { ok: false, error: `This save covers ${months.length} months; at most 600 can be saved at once.` };
  const rows = lines.map((l) => ({ day: l.day, period: l.period, number: l.number, journal: l.journal, method: l.method, partner: l.partner, direction: l.direction, amount: l.amount, currency: l.currency, amount_currency: l.amountCurrency, state: l.state, ...(l.kind ? { kind: l.kind, counter: l.counter ?? "" } : {}) }));
  return saveStaged(rows, {
    // "Replace all" with nothing new still needs one month to open the save; every month of the source goes anyway.
    open: () => startPaymentBatch(companyId, months.length ? months : [new Date().toISOString().slice(0, 7)], filename.slice(0, 300), source, !!opts.all),
    add: (batch, part, last, staged) => addPaymentLines(companyId, batch, part, last, staged),
    finish: (stage) => finishPaymentBatch(companyId, stage),
  }, { finishEmpty: true, onProgress });
}

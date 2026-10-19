"use client";
import { expensePeriods, type ExpenseLine } from "@/lib/ingest/expenses";
import { addExpenseLines, startExpenseBatch } from "@/app/company/[id]/settings/expense-actions";
import { ChunkStopped, orThrow, sendChunks, type ChunkOptions } from "@/lib/chunks";

/** Saves expense lines in chunks (split when the database is busy, retried when the connection drops), with progress. */
export async function saveExpenses(companyId: string, source: "ledger" | "file", lines: ExpenseLine[], filename: string, report: Record<string, unknown> = {}, opts: { all?: boolean; onProgress?: ChunkOptions["onProgress"] } = {}): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  if (!lines.length) return { ok: true, saved: 0 };
  const start = await startExpenseBatch({ companyId, source, periods: expensePeriods(lines), filename: filename.slice(0, 300), report, ...(opts.all ? { all: true } : {}) });
  if (!start.ok) return start;
  // Where a line was read (src) stays in the browser.
  const rows = lines.map((x) => {
      const { src, ...l } = x;
      void src;
      return { ...l, doc: l.doc.slice(0, 80), series: l.series.slice(0, 40), supplier: l.supplier.slice(0, 200), account: l.account.slice(0, 200), category: l.category.slice(0, 200), label: l.label.slice(0, 200) };
    });
  let saved = 0;
  try {
    await sendChunks(rows, async (part, { last }) => { saved += (await orThrow(addExpenseLines(companyId, start.batch, part, last))).saved; }, { onProgress: opts.onProgress });
  } catch (e) {
    return { ok: false, error: e instanceof ChunkStopped ? e.message : String(e) };
  }
  return { ok: true, saved };
}

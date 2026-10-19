"use client";
import type { SalesLine } from "@/lib/ingest/sales";
import { salesPeriods } from "@/lib/ingest/sales";
import { addSalesLines, startSalesBatch } from "@/app/company/[id]/settings/sales-actions";
import { ChunkStopped, orThrow, sendChunks, type ChunkOptions } from "@/lib/chunks";

/** Saves sales lines in chunks (split when the database is busy, retried when the connection drops), with progress. */
export async function saveSales(companyId: string, source: "ledger" | "file", lines: SalesLine[], filename: string, report: Record<string, unknown> = {}, opts: { all?: boolean; onProgress?: ChunkOptions["onProgress"] } = {}): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  if (!lines.length) return { ok: true, saved: 0 };
  const start = await startSalesBatch({ companyId, source, periods: salesPeriods(lines), filename: filename.slice(0, 300), report, ...(opts.all ? { all: true } : {}) });
  if (!start.ok) return start;
  // Where a line was read (src) stays in the browser.
  const rows = lines.map((x) => {
      const { src, ...l } = x;
      void src;
      return {
      ...l, doc: l.doc.slice(0, 80), series: l.series.slice(0, 40), customer: l.customer.slice(0, 200), product: l.product.slice(0, 300), category: l.category.slice(0, 200), salesperson: l.salesperson.slice(0, 120),
      };
    });
  let saved = 0;
  try {
    await sendChunks(rows, async (part, { last }) => { saved += (await orThrow(addSalesLines(companyId, start.batch, part, last))).saved; }, { onProgress: opts.onProgress });
  } catch (e) {
    return { ok: false, error: e instanceof ChunkStopped ? e.message : String(e) };
  }
  return { ok: true, saved };
}

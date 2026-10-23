"use client";
import type { SalesLine } from "@/lib/ingest/sales";
import { salesPeriods } from "@/lib/ingest/sales";
import { addSalesLines, finishSalesBatch, startSalesBatch } from "@/app/company/[id]/settings/sales-actions";
import { discardEmptyBatch } from "@/app/company/[id]/settings/ledger-actions";
import type { ChunkOptions } from "@/lib/chunks";
import { saveStaged } from "@/lib/company/save-lines";

/**
 * Saves sales lines as one staged save: chunks are held, then the months are replaced in one step at the
 * finish. `months` adds months to replace that the lines may not cover (an import that replaced them); with `all` every
 * month of the source goes. Either runs even with no lines, so old lines never outlive the months they came from.
 */
export async function saveSales(companyId: string, source: "ledger" | "file", lines: SalesLine[], filename: string, report: Record<string, unknown> = {}, opts: { all?: boolean; months?: string[]; onProgress?: ChunkOptions["onProgress"] } = {}): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  const start = { companyId, source, periods: [...new Set([...salesPeriods(lines), ...(opts.months ?? [])])].sort(), filename: filename.slice(0, 300), report, ...(opts.all ? { all: true } : {}) };
  // Where a line was read (src) stays in the browser.
  const rows = lines.map((x) => {
    const { src, ...l } = x;
    void src;
    return { ...l, doc: l.doc.slice(0, 80), series: l.series.slice(0, 40), customer: l.customer.slice(0, 200), product: l.product.slice(0, 300), category: l.category.slice(0, 200), salesperson: l.salesperson.slice(0, 120) };
  });
  return saveStaged(rows, {
    open: () => startSalesBatch(start),
    add: (batch, part, last, staged) => addSalesLines(companyId, batch, part, last, staged),
    finish: (stage) => finishSalesBatch(start, stage),
    discard: (batch) => discardEmptyBatch(companyId, "sales", batch),
  }, { onProgress: opts.onProgress, finishEmpty: !!opts.all || !!opts.months?.length });
}

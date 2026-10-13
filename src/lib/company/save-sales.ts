"use client";
import type { SalesLine } from "@/lib/ingest/sales";
import { salesPeriods } from "@/lib/ingest/sales";
import { addSalesLines, startSalesBatch } from "@/app/company/[id]/settings/sales-actions";

const CHUNK = 3000;

/** Saves sales lines in chunks the server accepts (each request stays well under the size limit). */
export async function saveSales(companyId: string, source: "ledger" | "file", lines: SalesLine[], filename: string, report: Record<string, unknown> = {}): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  if (!lines.length) return { ok: true, saved: 0 };
  const start = await startSalesBatch({ companyId, source, periods: salesPeriods(lines), filename: filename.slice(0, 300), report });
  if (!start.ok) return start;
  let saved = 0;
  for (let i = 0; i < lines.length; i += CHUNK) {
    const part = lines.slice(i, i + CHUNK).map((l) => ({
      ...l, doc: l.doc.slice(0, 80), series: l.series.slice(0, 40), customer: l.customer.slice(0, 200), product: l.product.slice(0, 300), category: l.category.slice(0, 200), salesperson: l.salesperson.slice(0, 120),
    }));
    const out = await addSalesLines(companyId, start.batch, part, i + CHUNK >= lines.length);
    if (!out.ok) return out;
    saved += out.saved;
  }
  return { ok: true, saved };
}

"use client";
import { expensePeriods, type ExpenseLine } from "@/lib/ingest/expenses";
import { addExpenseLines, finishExpenseBatch, startExpenseBatch } from "@/app/company/[id]/settings/expense-actions";
import { discardEmptyBatch } from "@/app/company/[id]/settings/ledger-actions";
import type { ChunkOptions } from "@/lib/chunks";
import { saveStaged } from "@/lib/company/save-lines";

/**
 * Saves expense lines as one staged save: chunks are held, then the months are replaced in one step at the
 * finish. `months` adds months to replace that the lines may not cover (an import that replaced them); with `all` every
 * month of the source goes. Either runs even with no lines, so old lines never outlive the months they came from.
 */
export async function saveExpenses(companyId: string, source: "ledger" | "file", lines: ExpenseLine[], filename: string, report: Record<string, unknown> = {}, opts: { all?: boolean; months?: string[]; onProgress?: ChunkOptions["onProgress"] } = {}): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  const start = { companyId, source, periods: [...new Set([...expensePeriods(lines), ...(opts.months ?? [])])].sort(), filename: filename.slice(0, 300), report, ...(opts.all ? { all: true } : {}) };
  // Where a line was read (src) stays in the browser.
  const rows = lines.map((x) => {
    const { src, ...l } = x;
    void src;
    return { ...l, doc: l.doc.slice(0, 80), series: l.series.slice(0, 40), supplier: l.supplier.slice(0, 200), account: l.account.slice(0, 200), category: l.category.slice(0, 200), label: l.label.slice(0, 200) };
  });
  return saveStaged(rows, {
    open: () => startExpenseBatch(start),
    add: (batch, part, last, staged) => addExpenseLines(companyId, batch, part, last, staged),
    finish: (stage) => finishExpenseBatch(start, stage),
    discard: (batch) => discardEmptyBatch(companyId, "expenses", batch),
  }, { onProgress: opts.onProgress, finishEmpty: !!opts.all || !!opts.months?.length });
}

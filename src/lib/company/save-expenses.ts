"use client";
import { expensePeriods, type ExpenseLine } from "@/lib/ingest/expenses";
import { addExpenseLines, startExpenseBatch } from "@/app/company/[id]/settings/expense-actions";

const CHUNK = 3000;

/** Saves expense lines in chunks the server accepts (each request stays well under the size limit). */
export async function saveExpenses(companyId: string, source: "ledger" | "file", lines: ExpenseLine[], filename: string, report: Record<string, unknown> = {}): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  if (!lines.length) return { ok: true, saved: 0 };
  const start = await startExpenseBatch({ companyId, source, periods: expensePeriods(lines), filename: filename.slice(0, 300), report });
  if (!start.ok) return start;
  let saved = 0;
  for (let i = 0; i < lines.length; i += CHUNK) {
    // Where a line was read (src) stays in the browser.
    const part = lines.slice(i, i + CHUNK).map((x) => {
      const { src, ...l } = x;
      void src;
      return { ...l, doc: l.doc.slice(0, 80), series: l.series.slice(0, 40), supplier: l.supplier.slice(0, 200), account: l.account.slice(0, 200), category: l.category.slice(0, 200), label: l.label.slice(0, 200) };
    });
    const out = await addExpenseLines(companyId, start.batch, part, i + CHUNK >= lines.length);
    if (!out.ok) return out;
    saved += out.saved;
  }
  return { ok: true, saved };
}

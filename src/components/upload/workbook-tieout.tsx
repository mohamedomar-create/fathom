"use client";
import { CheckCircle2, CircleAlert, Info } from "lucide-react";
import { money } from "@/lib/engine";
import type { WorkbookTie } from "@/lib/ingest/workbook";
import { cellRef } from "@/lib/ingest/trace";
import { cn } from "@/lib/cn";

/** Mismatches first, then the figures that match or are explained, then lone figures that may be targets. */
const ORDER = { bad: 0, ok: 1, explained: 1, alone: 2 } as const;

/**
 * The owner's own summary, figure by figure, beside what iReport read from all the tabs: the check that a workbook of
 * many tabs went in whole. Each line matches, is explained, may be a target, or does not match (and blocks saving).
 */
export function WorkbookTieout({ tie, currency }: { tie: WorkbookTie; currency: string }) {
  if (!tie.rows.length) return null;
  const bad = tie.rows.filter((r) => r.status === "bad").length;
  const ok = tie.rows.filter((r) => r.status === "ok" || r.status === "explained").length;
  return (
    <section className="mb-5 max-w-5xl rounded-xl border border-line" data-testid="workbook-tieout">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-2.5">
        <h3 className="text-[16px] font-medium">Your workbook vs iReport</h3>
        <span className={cn("text-[13px]", bad ? "text-red" : "text-green-d")} data-testid="tieout-summary">
          {bad ? `${bad} of your figures do not match` : `${ok} of your figures match what iReport read`}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="text-left text-mute">
            <tr><th className="px-4 py-1.5 font-normal">Your figure</th><th className="px-2 py-1.5 font-normal">Where</th><th className="px-2 py-1.5 text-right font-normal">You wrote</th><th className="px-2 py-1.5 text-right font-normal">iReport read</th><th className="px-4 py-1.5 font-normal">Result</th></tr>
          </thead>
          <tbody>
            {[...tie.rows].sort((a, b) => ORDER[a.status] - ORDER[b.status]).map((r) => (
              <tr key={`${r.sheet}:${r.row}:${r.col}`} className="border-t border-line align-top" data-testid="tieout-row">
                <td className="px-4 py-1.5">{r.label}</td>
                <td className="px-2 py-1.5 text-mute">{r.sheet.split(" › ").pop()}, {cellRef(r.row, r.col)}</td>
                <td className="num whitespace-nowrap px-2 py-1.5 text-right">{money(r.file, currency)}</td>
                <td className="num whitespace-nowrap px-2 py-1.5 text-right">{money(r.read, currency)}</td>
                <td className="px-4 py-1.5">
                  {r.status === "ok" && <span className="flex items-center gap-1 text-green-d"><CheckCircle2 className="h-3.5 w-3.5" />Matches</span>}
                  {r.status === "explained" && <span className="flex items-start gap-1 text-green-d"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />Explained: {r.why}</span>}
                  {r.status === "alone" && <span className="flex items-start gap-1 text-mute"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />Differs: a target or plan?</span>}
                  {r.status === "bad" && <span className="flex items-start gap-1 text-red"><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />Does not match: fix it on the right</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

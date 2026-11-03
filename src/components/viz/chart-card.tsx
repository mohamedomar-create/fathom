"use client";
import { useState } from "react";
import { BarChart3, Table2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/use-t";
import { useStaticCharts } from "@/components/charts/static";

export interface CardTable { head: string[]; rows: React.ReactNode[][]; /** Columns that hold figures (aligned to the end). Default: all but the first. */ numeric?: number[] }

/**
 * One analyst card: a title that says the takeaway, the chart, and a toggle to the figures behind it (so no number lives
 * only in a colour or a shape). `wide` spans two columns of the grid.
 */
export function ChartCard({ title, sub, children, table, testId, wide, className, right }: {
  title: string; sub?: React.ReactNode; children: React.ReactNode; table?: CardTable; testId?: string; wide?: boolean; className?: string; right?: React.ReactNode;
}) {
  const { d } = useT();
  const st = useStaticCharts();
  const [showTable, setShowTable] = useState(false);
  return (
    <section className={cn("fade-up flex min-w-0 flex-col rounded-xl border border-line bg-white p-4 sm:p-5", wide && "lg:col-span-2", className)} data-testid={testId}>
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="t-card">{title}</h3>
          {sub && <p className="t-cap mt-0.5">{sub}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {right}
          {table && !st && (
            <button type="button" onClick={() => setShowTable((x) => !x)} aria-pressed={showTable}
              className="inline-flex min-h-6 items-center gap-1 rounded-md border border-line px-2 py-1 text-[11.5px] text-mute hover:border-ink hover:text-ink"
              title={showTable ? d.viz.showChart : d.viz.showTable} data-testid={testId ? `${testId}-toggle` : undefined}>
              {showTable ? <BarChart3 className="h-3.5 w-3.5" aria-hidden /> : <Table2 className="h-3.5 w-3.5" aria-hidden />}
              {showTable ? d.viz.chart : d.viz.table}
            </button>
          )}
        </div>
      </header>
      {showTable && table ? (
        <div tabIndex={0} className="overflow-x-auto" data-testid={testId ? `${testId}-table` : undefined}>
          <table className="tbl text-[12.5px]">
            <thead><tr>{table.head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i} className="row">{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : <div className="min-w-0 flex-1">{children}</div>}
    </section>
  );
}

/** The analyst grid under the cockpit: dense, two or three columns. */
export function CardGrid({ children, cols = 2, testId }: { children: React.ReactNode; cols?: 2 | 3; testId?: string }) {
  return <div className={cn("mb-8 grid gap-4", cols === 3 ? "lg:grid-cols-2 xl:grid-cols-3" : "lg:grid-cols-2")} data-testid={testId}>{children}</div>;
}

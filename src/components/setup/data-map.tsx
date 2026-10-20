"use client";
import { Check, Minus } from "lucide-react";
import type { ExpensesData, MonthData, SalesData } from "@/lib/engine";
import { cn } from "@/lib/cn";

import { dataMapRows, SECTORS, span, type Row } from "@/lib/company/data-map";

export { dataMapRows };

/** rows: worked out on the server (the Readiness page); otherwise from the months and summaries given. */
export function DataMap({ months, sales, expenses, rows: given }: { months?: MonthData[]; sales?: SalesData | null; expenses?: ExpensesData | null; rows?: Row[] }) {
  const rows = given ?? dataMapRows(months ?? [], sales ?? null, expenses ?? null);
  return (
    <section className="mb-10" data-testid="data-map">
      <h2 className="mb-1 text-xl font-light">Where your data goes</h2>
      <p className="mb-3 text-[13px] text-mute">One upload feeds every part it can.</p>
      {!rows.length ? <p className="text-sm text-mute">Nothing loaded yet. Start with step 2.</p> : (
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="tbl min-w-[640px] table-fixed text-[12.5px]">
            <thead><tr><th className="w-[190px] !text-start">What is loaded</th>{SECTORS.map((s) => <th key={s.key} className="!text-start">{s.label}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="row" data-testid={`map-row-${r.key}`}>
                  <td className="w-[190px] !text-start"><div className="font-medium">{r.source}</div>{r.from && <div className="text-[11.5px] text-mute">{r.from}</div>}<div className="text-[11.5px] text-mute">{span(r.months)}</div></td>
                  {SECTORS.map((s) => {
                    const f = r.feeds[s.key];
                    return (
                      <td key={s.key} className={cn("!whitespace-normal !text-start align-top", !f && "text-mute")} data-testid={`map-${r.key}-${s.key}`} data-on={f ? "1" : "0"}>
                        {f ? <span className="flex items-start gap-1 whitespace-normal"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-d" /><span className="min-w-0 whitespace-normal break-words">{f}</span></span> : <Minus className="h-3.5 w-3.5" />}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

"use client";
import { Check, Minus } from "lucide-react";
import { hasBS, hasPL, mlabel, type ExpensesData, type MonthData, type SalesData } from "@/lib/engine";
import { cn } from "@/lib/cn";

type Sector = "financials" | "sales" | "expenses" | "banking" | "forecast";
const SECTORS: { key: Sector; label: string }[] = [
  { key: "financials", label: "Financials" }, { key: "sales", label: "Sales" }, { key: "expenses", label: "Expenses" }, { key: "banking", label: "Banking" }, { key: "forecast", label: "Forecast" },
];
interface Row { key: string; source: string; from?: string; months: string[]; feeds: Partial<Record<Sector, string>> }

const span = (ps: string[]) => (!ps.length ? "–" : ps.length === 1 ? mlabel(ps[0]) : `${mlabel(ps[0])} – ${mlabel(ps[ps.length - 1])} (${ps.length})`);

/** What is loaded, row by row, and which part of it each sector uses: one upload feeds every sector it can. */
export function dataMapRows(months: MonthData[], sales: SalesData | null, expenses: ExpensesData | null): Row[] {
  const pl = months.filter(hasPL).map((m) => m.period).sort(), bs = months.filter(hasBS).map((m) => m.period).sort();
  const by = (src: Record<string, string> | undefined, s: string) => Object.entries(src ?? {}).filter(([, v]) => v === s).map(([p]) => p).sort();
  const sl = by(sales?.sources, "ledger"), sf = by(sales?.sources, "file"), el = by(expenses?.sources, "ledger"), ef = by(expenses?.sources, "file");
  const rows: Row[] = [];
  if (pl.length || bs.length) rows.push({
    key: "accounts", source: "Your accounts", from: "General Ledger, Trial Balance, P&L, PDF or Odoo", months: [...new Set([...pl, ...bs])].sort(),
    feeds: {
      financials: bs.length ? "P&L, balance sheet, cash flow" : "P&L", sales: pl.length ? "sales by revenue account" : undefined, expenses: pl.length ? "costs by account" : undefined,
      banking: bs.length ? "bank checks" : undefined, forecast: pl.length ? "starting point and trends" : undefined,
    },
  });
  if (sl.length || el.length) rows.push({ key: "ledger", source: "Lines in your ledger", from: "each invoice and bill, with its date and partner", months: [...new Set([...sl, ...el])].sort(), feeds: { sales: sl.length ? "customers and products" : undefined, expenses: el.length ? "suppliers and checks" : undefined } });
  if (sf.length) rows.push({ key: "sales-file", source: "Sales file", months: sf, feeds: { sales: "customers, products, quantities" } });
  if (ef.length) rows.push({ key: "expenses-file", source: "Expenses file", months: ef, feeds: { expenses: "suppliers and bills" } });
  return rows;
}

export function DataMap({ months, sales, expenses }: { months: MonthData[]; sales: SalesData | null; expenses: ExpensesData | null }) {
  const rows = dataMapRows(months, sales, expenses);
  return (
    <section className="mb-10" data-testid="data-map">
      <h2 className="mb-1 text-xl font-light">Where your data goes</h2>
      <p className="mb-3 text-[13px] text-mute">One upload feeds every part it can.</p>
      {!rows.length ? <p className="text-sm text-mute">Nothing loaded yet. Start with step 2.</p> : (
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="tbl min-w-[640px] table-fixed text-[12.5px]">
            <thead><tr><th className="w-[190px] !text-left">What is loaded</th>{SECTORS.map((s) => <th key={s.key} className="!text-left">{s.label}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="row" data-testid={`map-row-${r.key}`}>
                  <td className="w-[190px] !text-left"><div className="font-medium">{r.source}</div>{r.from && <div className="text-[11.5px] text-mute">{r.from}</div>}<div className="text-[11.5px] text-mute">{span(r.months)}</div></td>
                  {SECTORS.map((s) => {
                    const f = r.feeds[s.key];
                    return (
                      <td key={s.key} className={cn("!whitespace-normal !text-left align-top", !f && "text-mute")} data-testid={`map-${r.key}-${s.key}`} data-on={f ? "1" : "0"}>
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

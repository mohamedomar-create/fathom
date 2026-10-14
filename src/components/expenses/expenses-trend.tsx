"use client";
import { EXPENSE_GROUPS, mlabel, money, mshort, pct } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { PageHeader } from "@/components/shell/page-header";
import { LineChart } from "@/components/charts/line-chart";
import { C } from "@/components/charts/util";
import { cn } from "@/lib/cn";
import { DataNotes, ExpensesPicker, NoExpenses, useExpensesAnalysis } from "./common";

export function ExpensesTrend() {
  const c = useCompany();
  const s = useExpensesAnalysis();
  const cur = c.settings.currency;
  if (!s) return <><PageHeader title="Expenses Trend" /><NoExpenses /></>;
  const from = s.trend.findIndex((t) => t.total !== null);
  const rows = from < 0 ? [] : s.trend.slice(from);
  const groups = EXPENSE_GROUPS.filter((g) => rows.some((t) => t.groups[g.key]));
  return (
    <>
      <PageHeader title="Expenses Trend" right={<ExpensesPicker s={s} mode="upto" />} />
      <h2 className="mb-1 text-xl font-light">Monthly costs by type</h2>
      <p className="mb-2 text-xs text-mute">Months to {mlabel(s.window.end)}.</p>
      <LineChart labels={rows.map((t) => mshort(t.period))} cur={cur} height={300} testId="group-trend"
        series={groups.map((g, i) => ({ name: g.name, values: rows.map((t) => (t.total === null ? null : t.groups[g.key] ?? 0)), color: C.s[i % 5] }))} />
      <h2 className="mb-1 mt-10 text-xl font-light">Costs as a % of sales</h2>
      <LineChart labels={rows.map((t) => mshort(t.period))} unit="%" height={220} testId="of-sales-trend"
        series={[{ name: "Costs as % of sales", values: rows.map((t) => t.ofSales), color: C.s[1], fill: true }]} />
      <h2 className="mb-3 mt-10 text-xl font-light">Month by month</h2>
      <div className="-mx-4 overflow-x-auto sm:mx-0">
        <table className="tbl min-w-[620px]" data-testid="expenses-month-table">
          <thead><tr><th className="text-start">Month</th><th>P&amp;L costs</th><th>% of sales</th><th>Expense lines</th><th>Difference</th></tr></thead>
          <tbody>
            {[...rows].reverse().filter((t) => t.total !== null).map((t) => {
              const diff = t.lines === null ? null : t.lines - t.total!;
              const off = diff !== null && Math.abs(diff) > Math.max(1, Math.abs(t.total!) * 0.005);
              return (
                <tr key={t.period} className="row">
                  <td className="text-start">{mlabel(t.period)}</td>
                  <td className="num">{money(t.total, cur)}</td>
                  <td className="num">{t.ofSales === null ? "–" : pct(t.ofSales, 1)}</td>
                  <td className="num">{t.lines === null ? "–" : money(t.lines, cur)}</td>
                  <td className={cn("num", off ? "text-red" : "text-mute")}>{diff === null ? "–" : money(diff, cur)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <DataNotes notes={s.notes} />
    </>
  );
}

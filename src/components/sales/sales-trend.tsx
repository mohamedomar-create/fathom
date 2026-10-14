"use client";
import { mlabel, money, mshort } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { PageHeader } from "@/components/shell/page-header";
import { LineChart } from "@/components/charts/line-chart";
import { C } from "@/components/charts/util";
import { cn } from "@/lib/cn";
import { DataNotes, NoSales, useSalesAnalysis, SalesPicker } from "./common";

export function SalesTrend() {
  const c = useCompany();
  const s = useSalesAnalysis();
  const cur = c.settings.currency;
  if (!s) return <><PageHeader title="Sales Trend" /><NoSales /></>;
  const held = s.trend.filter((t) => t.sales !== null);
  const from = s.trend.findIndex((t) => t.sales !== null);
  const rows = from < 0 ? [] : s.trend.slice(from);
  const cats = [...s.topCategories, ...(rows.some((t) => t.categories.Other) ? ["Other"] : [])];
  return (
    <>
      <PageHeader title="Sales Trend" right={<SalesPicker s={s} mode="upto" />} />
      <h2 className="mb-1 text-xl font-light">Monthly sales by category</h2>
      <p className="mb-2 text-xs text-mute">The five largest categories in the period, the rest as Other. Months to {mlabel(s.window.end)}.</p>
      <LineChart labels={rows.map((t) => mshort(t.period))} cur={cur} height={300} testId="category-trend"
        series={cats.map((k, i) => ({ name: k, values: rows.map((t) => (t.sales === null ? null : t.categories[k] ?? 0)), color: k === "Other" ? C.mute : C.s[i % 5], dashed: k === "Other" }))} />
      <h2 className="mb-3 mt-10 text-xl font-light">Sales against P&amp;L revenue</h2>
      <div className="-mx-4 overflow-x-auto sm:mx-0">
        <table className="tbl min-w-[560px]" data-testid="reconciliation-table">
          <thead><tr><th className="text-start">Month</th><th>Sales lines</th><th>P&amp;L revenue</th><th>Difference</th></tr></thead>
          <tbody>
            {[...held].reverse().map((t) => {
              const off = t.diff !== null && t.revenue !== null && Math.abs(t.diff) > Math.max(1, Math.abs(t.revenue) * 0.005);
              return (
                <tr key={t.period} className="row">
                  <td className="text-start">{mlabel(t.period)}</td>
                  <td className="num">{money(t.sales, cur)}</td>
                  <td className="num">{t.revenue === null ? "–" : money(t.revenue, cur)}</td>
                  <td className={cn("num", off ? "text-red" : "text-mute")}>{t.diff === null ? "–" : money(t.diff, cur)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-mute">Differences above 0.5% are shown in red. Revenue posted by journal entry instead of invoice is the usual cause.</p>
      <DataNotes notes={s.notes} />
    </>
  );
}

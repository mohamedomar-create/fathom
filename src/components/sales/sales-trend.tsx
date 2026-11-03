"use client";
import { money } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { PageHeader } from "@/components/shell/page-header";
import { LineChart } from "@/components/charts/line-chart";
import { C } from "@/components/charts/util";
import { cn } from "@/lib/cn";
import { balanced } from "@/lib/tolerance";
import { DataNotes, NoSales, useSalesAnalysis, SalesPicker } from "./common";
import { useT } from "@/lib/i18n/use-t";
import { CardGrid, ChartCard } from "@/components/viz/chart-card";
import { HeatCalendar } from "@/components/viz/heat-calendar";
import { compact } from "@/lib/engine/format";

export function SalesTrend() {
  const c = useCompany();
  const s = useSalesAnalysis();
  const T = useT();
  const t = T.d.sales;
  const title = T.d.nav["sales/trend"][1];
  const cur = c.settings.currency;
  if (!s) return <><PageHeader title={title} /><NoSales /></>;
  const held = s.trend.filter((x) => x.sales !== null);
  const from = s.trend.findIndex((x) => x.sales !== null);
  const rows = from < 0 ? [] : s.trend.slice(from);
  const cats = [...s.topCategories, ...(rows.some((x) => x.categories.Other) ? ["Other"] : [])];
  return (
    <>
      <PageHeader title={title} right={<SalesPicker s={s} mode="upto" />} />
      <CardGrid>
      <ChartCard title={t.byCategoryMonthly} sub={t.trendNote(T.ml(s.window.end))} wide testId="card-category-trend">
      <LineChart labels={rows.map((x) => T.ms(x.period))} cur={cur} height={300} testId="category-trend"
        series={cats.map((k, i) => ({ name: T.tl(k), values: rows.map((x) => (x.sales === null ? null : x.categories[k] ?? 0)), color: k === "Other" ? C.mute : C.s[i % C.s.length], dashed: k === "Other" }))} />
      </ChartCard>
      <ChartCard title={T.d.viz.mod.salesByMonth} sub={T.d.viz.mod.salesByMonthSub} wide testId="card-trend-heat">
        <HeatCalendar periods={rows.map((x) => x.period)} values={rows.map((x) => x.sales)} fmt={(v) => compact(v, T.lang === "ar" ? "ar" : "en")} label={T.d.viz.mod.salesByMonth} />
      </ChartCard>
      </CardGrid>
      <h2 className="mb-3 mt-10 text-lg font-semibold">{t.vsRevenue}</h2>
      <div tabIndex={0} className="-mx-4 overflow-x-auto sm:mx-0">
        <table className="tbl min-w-[560px]" data-testid="reconciliation-table">
          <thead><tr><th className="text-start">{t.month}</th><th>{t.salesLines}</th><th>{t.plRevenue}</th><th>{t.difference}</th></tr></thead>
          <tbody>
            {[...held].reverse().map((x) => {
              const off = x.diff !== null && x.revenue !== null && !balanced(x.diff);
              return (
                <tr key={x.period} className="row">
                  <td className="text-start">{T.ml(x.period)}</td>
                  <td className="num">{money(x.sales, cur)}</td>
                  <td className="num">{x.revenue === null ? "–" : money(x.revenue, cur)}</td>
                  <td className={cn("num", off ? "text-red" : "text-mute")}>{x.diff === null ? "–" : money(x.diff, cur)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-mute">{t.diffNote}</p>
      <DataNotes notes={s.notes} />
    </>
  );
}

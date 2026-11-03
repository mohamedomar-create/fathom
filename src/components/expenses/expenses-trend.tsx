"use client";
import { EXPENSE_GROUPS, money, pct } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { PageHeader } from "@/components/shell/page-header";
import { LineChart } from "@/components/charts/line-chart";
import { C } from "@/components/charts/util";
import { cn } from "@/lib/cn";
import { balanced } from "@/lib/tolerance";
import { DataNotes, ExpensesPicker, NoExpenses, useExpensesAnalysis } from "./common";
import { useT } from "@/lib/i18n/use-t";
import { CardGrid, ChartCard } from "@/components/viz/chart-card";
import { HeatCalendar } from "@/components/viz/heat-calendar";
import { compact } from "@/lib/engine/format";

export function ExpensesTrend() {
  const c = useCompany();
  const s = useExpensesAnalysis();
  const T = useT();
  const t = T.d.exp;
  const title = T.d.nav["expenses/trend"][1];
  const cur = c.settings.currency;
  if (!s) return <><PageHeader title={title} /><NoExpenses /></>;
  const from = s.trend.findIndex((x) => x.total !== null);
  const rows = from < 0 ? [] : s.trend.slice(from);
  const groups = EXPENSE_GROUPS.filter((g) => rows.some((x) => x.groups[g.key]));
  return (
    <>
      <PageHeader title={title} right={<ExpensesPicker s={s} mode="upto" />} />
      <CardGrid>
      <ChartCard title={t.byTypeMonthly} sub={t.monthsTo(T.ml(s.window.end))} wide testId="card-group-trend">
      <LineChart labels={rows.map((x) => T.ms(x.period))} cur={cur} height={300} testId="group-trend"
        series={groups.map((g, i) => ({ name: T.tl(g.name), values: rows.map((x) => (x.total === null ? null : x.groups[g.key] ?? 0)), color: C.s[i % C.s.length] }))} />
      </ChartCard>
      <ChartCard title={t.asPctSales} testId="card-of-sales">
      <LineChart labels={rows.map((x) => T.ms(x.period))} unit="%" height={220} testId="of-sales-trend"
        series={[{ name: t.costsPct, values: rows.map((x) => x.ofSales), color: C.s[1], fill: true }]} />
      </ChartCard>
      <ChartCard title={T.d.viz.mod.costByMonth} sub={T.d.viz.mod.costByMonthSub} testId="card-exp-heat">
        <HeatCalendar periods={rows.map((x) => x.period)} values={rows.map((x) => x.total)} fmt={(v) => compact(v, T.lang === "ar" ? "ar" : "en")} label={T.d.viz.mod.costByMonth} />
      </ChartCard>
      </CardGrid>
      <h2 className="mb-3 mt-10 text-lg font-semibold">{t.monthByMonth}</h2>
      <div tabIndex={0} className="-mx-4 overflow-x-auto sm:mx-0">
        <table className="tbl min-w-[620px]" data-testid="expenses-month-table">
          <thead><tr><th className="text-start">{t.month}</th><th>{t.plCosts}</th><th>{t.pctSales}</th><th>{t.expenseLines}</th><th>{t.difference}</th></tr></thead>
          <tbody>
            {[...rows].reverse().filter((x) => x.total !== null).map((x) => {
              const diff = x.lines === null ? null : x.lines - x.total!;
              const off = diff !== null && !balanced(diff);
              return (
                <tr key={x.period} className="row">
                  <td className="text-start">{T.ml(x.period)}</td>
                  <td className="num">{money(x.total, cur)}</td>
                  <td className="num">{x.ofSales === null ? "–" : pct(x.ofSales, 1)}</td>
                  <td className="num">{x.lines === null ? "–" : money(x.lines, cur)}</td>
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

"use client";
import { EXPENSE_GROUPS, money, pct } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { PageHeader } from "@/components/shell/page-header";
import { LineChart } from "@/components/charts/line-chart";
import { C } from "@/components/charts/util";
import { cn } from "@/lib/cn";
import { DataNotes, ExpensesPicker, NoExpenses, useExpensesAnalysis } from "./common";
import { useT } from "@/lib/i18n/use-t";

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
      <h2 className="mb-1 text-xl font-light">{t.byTypeMonthly}</h2>
      <p className="mb-2 text-xs text-mute">{t.monthsTo(T.ml(s.window.end))}</p>
      <LineChart labels={rows.map((x) => T.ms(x.period))} cur={cur} height={300} testId="group-trend"
        series={groups.map((g, i) => ({ name: T.tl(g.name), values: rows.map((x) => (x.total === null ? null : x.groups[g.key] ?? 0)), color: C.s[i % 5] }))} />
      <h2 className="mb-1 mt-10 text-xl font-light">{t.asPctSales}</h2>
      <LineChart labels={rows.map((x) => T.ms(x.period))} unit="%" height={220} testId="of-sales-trend"
        series={[{ name: t.costsPct, values: rows.map((x) => x.ofSales), color: C.s[1], fill: true }]} />
      <h2 className="mb-3 mt-10 text-xl font-light">{t.monthByMonth}</h2>
      <div className="-mx-4 overflow-x-auto sm:mx-0">
        <table className="tbl min-w-[620px]" data-testid="expenses-month-table">
          <thead><tr><th className="text-start">{t.month}</th><th>{t.plCosts}</th><th>{t.pctSales}</th><th>{t.expenseLines}</th><th>{t.difference}</th></tr></thead>
          <tbody>
            {[...rows].reverse().filter((x) => x.total !== null).map((x) => {
              const diff = x.lines === null ? null : x.lines - x.total!;
              const off = diff !== null && Math.abs(diff) > Math.max(1, Math.abs(x.total!) * 0.005);
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

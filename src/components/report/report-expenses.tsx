"use client";
import { useMemo } from "react";
import { accountsFromLines, customersOf, EMPTY_EXPENSES, EMPTY_SALES, expenseMonths, expensesAnalysis, isExpenseClass, money, mshort, notSupplier, pct, type ExpenseRow } from "@/lib/engine";
import { LineChart } from "@/components/charts/line-chart";
import { C } from "@/components/charts/util";
import type { ReportInput } from "@/lib/report/types";
import { useT } from "@/lib/i18n/use-t";

/** True when the report has costs to show (P&L cost accounts, or expense lines). */
export const hasExpenses = (input: Pick<ReportInput, "accounts" | "expenses">) => input.accounts.some((a) => isExpenseClass(a.cls) && Object.values(a.amounts).some(Boolean)) || Boolean(input.expenses && expenseMonths(input.expenses).length);

const Tile = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="border-t-2 border-line pt-1.5"><div className="label">{label}</div><div className="num text-[19px]">{value}</div>{sub && <div className="text-[10.5px] text-mute">{sub}</div>}</div>
);

function Rows({ title, rows, cur }: { title: string; rows: ExpenseRow[]; cur: string }) {
  const T = useT();
  return (
    <div>
      <div className="label mb-1">{title}</div>
      <table className="tbl text-[11px]">
        <tbody>
          {rows.slice(0, 8).map((r) => <tr key={r.key}><td className="max-w-[200px] truncate">{T.tl(r.name)}</td><td>{money(r.amount, cur)}</td><td className="text-mute">{pct(r.share, 1)}</td><td>{r.growth === null ? "–" : `${r.growth >= 0 ? "+" : ""}${r.growth.toFixed(1)}%`}</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}

/** Expenses: what was spent and how it changed, the largest accounts and suppliers, the months, and what to check. */
export function ReportExpenses({ input, head }: { input: ReportInput; head: (title: string) => React.ReactNode }) {
  const T = useT();
  const t = T.d.rep.doc;
  const lang = T.lang;
  const cur = input.settings.currency;
  const s = useMemo(() => {
    const lines = input.expenses ?? EMPTY_EXPENSES;
    // With no P&L costs (an expenses file only), the lines' own accounts stand in.
    const fromPL = input.accounts.some((a) => isExpenseClass(a.cls));
    if (!fromPL && !expenseMonths(lines).length) return null;
    const revenue = Object.fromEntries(input.months.filter((m) => Object.keys(m.pl).length).map((m) => [m.period, m.pl.revenue ?? 0]));
    return expensesAnalysis(fromPL ? input.accounts : accountsFromLines(lines), lines, input.sel, input.settings.fyStartMonth, { revenue, customers: customersOf(input.sales ?? EMPTY_SALES), fromLines: !fromPL, asOf: input.asOf, lang });
  }, [input.sales, input.accounts, input.expenses, input.months, input.sel, input.settings.fyStartMonth, input.asOf, lang]);
  if (!s) return null;
  const last12 = s.trend.slice(-12), prev12 = s.trend.slice(0, 12);
  return (
    <>
      {head(T.d.rep.secs.expenses)}
      <div className="mb-4 grid grid-cols-4 gap-3">
        <Tile label={t.totalCostsTile} value={money(s.total, cur, true)} sub={s.growth === null ? undefined : t.vs(`${s.growth >= 0 ? "+" : ""}${s.growth.toFixed(1)}%`, s.compareLabel)} />
        <Tile label={t.costsPct} value={s.ofSales === null ? "–" : pct(s.ofSales, 1)} sub={s.ofSalesCompare === null ? undefined : t.was(pct(s.ofSalesCompare, 1))} />
        <Tile label={t.fixedTile} value={money(s.split.fixed, cur, true)} sub={s.total ? t.ofCosts(pct((s.split.fixed / s.total) * 100, 0)) : undefined} />
        <Tile label={t.top5} value={s.concentration.top5Share === null ? "–" : pct(s.concentration.top5Share, 0)} sub={s.lines.has ? t.ofNamed : t.needsExpLines} />
      </div>
      <div className="mb-3 grid grid-cols-2 gap-6">
        <Rows title={t.largestAccounts} rows={s.byAccount} cur={cur} />
        {s.lines.has ? <Rows title={t.largestSuppliers} rows={s.bySupplier.filter((r) => r.amount > 0 && !notSupplier(r.key))} cur={cur} /> : <Rows title={t.byType} rows={s.byGroup} cur={cur} />}
      </div>
      {s.byLender.length > 0 && (
        <p className="mb-3 text-[12px]" data-testid="report-lenders">
          <b className="font-semibold">{t.banks}</b>{t.banksLine(money(s.finance.interest, cur), money(s.finance.fees, cur))}{s.byLender.slice(0, 4).map((r) => `${T.tl(r.name)} ${money(r.amount, cur, true)}`).join(" · ")}
        </p>
      )}
      <LineChart labels={last12.map((x) => (lang === "ar" ? T.ms(x.period) : mshort(x.period)))} cur={cur} height={190}
        series={[{ name: t.last12m, values: last12.map((x) => x.total), color: C.s[1], fill: true }, { name: t.prev12m, values: prev12.map((x) => x.total), color: C.mute, dashed: true, dots: false }]} />
      <div className="rcomment mt-2">
        {s.findings.slice(0, 4).map((f) => <div key={f.title} className="py-0.5"><b className="font-semibold">{f.title}.</b> {f.text}</div>)}
      </div>
    </>
  );
}

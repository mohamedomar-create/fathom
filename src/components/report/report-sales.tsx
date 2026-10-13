"use client";
import { useMemo } from "react";
import { mlabel, money, mshort, pct, salesAnalysis, salesMonths, type SalesData, type SalesRow } from "@/lib/engine";
import { LineChart } from "@/components/charts/line-chart";
import { C } from "@/components/charts/util";
import type { ReportInput } from "@/lib/report/types";

/** True when the report has sales lines for the months it covers. */
export const hasSales = (d?: SalesData) => Boolean(d && salesMonths(d).length);

const Tile = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="border-t-2 border-line pt-1.5"><div className="label">{label}</div><div className="num text-[19px]">{value}</div>{sub && <div className="text-[10.5px] text-mute">{sub}</div>}</div>
);

function Rows({ title, rows, cur }: { title: string; rows: SalesRow[]; cur: string }) {
  return (
    <div>
      <div className="label mb-1">{title}</div>
      <table className="tbl text-[11px]">
        <tbody>
          {rows.slice(0, 8).map((r) => <tr key={r.key}><td className="max-w-[200px] truncate">{r.name}</td><td>{money(r.amount, cur)}</td><td className="text-mute">{pct(r.share, 1)}</td><td>{r.growth === null ? "–" : `${r.growth >= 0 ? "+" : ""}${r.growth.toFixed(1)}%`}</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}

/** Sales: the headline figures, categories and customers, the year's months and the reconciliation to P&L revenue. */
export function ReportSales({ input, head }: { input: ReportInput; head: (title: string) => React.ReactNode }) {
  const cur = input.settings.currency;
  const s = useMemo(() => {
    if (!input.sales || !hasSales(input.sales)) return null;
    const revenue = Object.fromEntries(input.months.filter((m) => Object.keys(m.pl).length).map((m) => [m.period, m.pl.revenue ?? 0]));
    return salesAnalysis(input.sales, input.sel, input.settings.fyStartMonth, { revenue });
  }, [input.sales, input.months, input.sel, input.settings.fyStartMonth]);
  if (!s) return null;
  const last12 = s.trend.slice(-12), prev12 = s.trend.slice(0, 12);
  const checked = s.trend.filter((t) => s.window.periods.includes(t.period) && t.sales !== null && t.revenue !== null).length;
  return (
    <>
      {head("Sales")}
      <div className="mb-4 grid grid-cols-6 gap-3">
        <Tile label="Net sales" value={money(s.total, cur, true)} sub={s.growth === null ? undefined : `${s.growth >= 0 ? "+" : ""}${s.growth.toFixed(1)}% vs ${s.compareLabel}`} />
        <Tile label="Invoices" value={s.invoices.toLocaleString("en-US")} />
        <Tile label="Average invoice" value={s.avgInvoice === null ? "–" : money(s.avgInvoice, cur, true)} />
        <Tile label="Active customers" value={String(s.customers.active)} sub={s.customers.new === null ? undefined : `${s.customers.new} new`} />
        <Tile label="Top 10 customers" value={s.customers.top10Share === null ? "–" : pct(s.customers.top10Share, 0)} sub="of sales" />
        <Tile label="Gross margin" value={s.margin === null ? "–" : pct(s.margin, 1)} sub={s.margin === null ? "cost not loaded" : undefined} />
      </div>
      <div className="mb-3 grid grid-cols-2 gap-6">
        <Rows title="Categories" rows={s.byCategory} cur={cur} />
        <Rows title="Largest customers" rows={s.byCustomer.filter((r) => r.amount > 0)} cur={cur} />
      </div>
      <LineChart labels={last12.map((t) => mshort(t.period))} cur={cur} height={190}
        series={[{ name: "Last 12 months", values: last12.map((t) => t.sales), color: C.s[0], fill: true }, { name: "The 12 months before", values: prev12.map((t) => t.sales), color: C.mute, dashed: true, dots: false }]} />
      <div className="rcomment mt-2">
        {s.findings.slice(0, 3).map((f) => <div key={f.title} className="py-0.5"><b className="font-semibold">{f.title}.</b> {f.text}</div>)}
        {checked > 0 && (s.unreconciled.length
          ? <div className="py-0.5 text-red">Sales differ from P&amp;L revenue in {s.unreconciled.map((u) => mlabel(u.period)).join(", ")}.</div>
          : <div className="py-0.5">Sales agree with P&amp;L revenue in {checked === 1 ? "the month" : `all ${checked} months`}.</div>)}
      </div>
    </>
  );
}

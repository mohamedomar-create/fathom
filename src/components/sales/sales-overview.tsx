"use client";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { mlabel, money, mshort, pct } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { PageHeader } from "@/components/shell/page-header";
import { LineChart } from "@/components/charts/line-chart";
import { BarList } from "@/components/charts/bar-list";
import { C } from "@/components/charts/util";
import { DataNotes, Findings, NoSales, SalesTile, useSalesAnalysis, vs, SalesPicker } from "./common";

export function SalesOverview() {
  const c = useCompany();
  const s = useSalesAnalysis();
  const cur = c.settings.currency;
  if (!s) return <><PageHeader title="Sales Overview" /><NoSales /></>;
  const cu = s.customers;
  const last12 = s.trend.slice(-12);
  const prev12 = s.trend.slice(0, 12);
  const checked = s.trend.filter((t) => s.window.periods.includes(t.period) && t.sales !== null && t.revenue !== null).length;
  const headline = `${c.name} invoiced ${money(s.total, cur)} in ${s.window.label}${s.growth !== null ? `, ${s.growth >= 0 ? "up" : "down"} ${Math.abs(s.growth).toFixed(1)}% on ${s.compareLabel}` : ""}, across ${s.invoices.toLocaleString("en-US")} invoice${s.invoices === 1 ? "" : "s"} to ${cu.active} customer${cu.active === 1 ? "" : "s"}${s.byCategory[0] ? `; ${s.byCategory[0].name} is the largest category at ${pct(s.byCategory[0].share, 0)} of sales` : ""}.`;
  return (
    <>
      <PageHeader title="Sales Overview" right={<SalesPicker s={s} />} />
      <p className="fade-up mb-6 max-w-4xl text-[17px] leading-relaxed" data-testid="sales-headline">{headline}</p>
      <div className="mb-8 grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-3 xl:grid-cols-6">
        <SalesTile label="Net sales" value={money(s.total, cur)} sub={vs(s.growth, s.compareLabel)} neg={s.total < 0 || (s.growth ?? 0) < 0} testId="tile-sales" />
        <SalesTile label="Invoices" value={s.invoices.toLocaleString("en-US")} sub={<span className="text-mute">{s.lines.toLocaleString("en-US")} lines</span>} />
        <SalesTile label="Average invoice" value={s.avgInvoice === null ? "–" : money(s.avgInvoice, cur)} sub={<span className="text-mute">net of tax</span>} />
        <SalesTile label="Active customers" value={cu.active.toLocaleString("en-US")} sub={<span className="text-mute">{cu.new === null ? "new customers need earlier months" : `${cu.new} new · ${cu.returning} returning`}</span>} />
        <SalesTile label="Top 10 customers" value={cu.top10Share === null ? "–" : pct(cu.top10Share, 0)} sub={<span className="text-mute">{cu.topName ? `largest: ${pct(cu.topShare ?? 0, 0)}` : "of sales"}</span>} neg={(cu.topShare ?? 0) > 20} />
        <SalesTile label="Gross margin" value={s.margin === null ? "–" : pct(s.margin, 1)} sub={<span className="text-mute">{s.margin === null ? "needs product cost" : `cost known for ${pct(s.costCoverage, 0)}`}</span>} />
      </div>
      <Reconciliation s={s} cur={cur} checked={checked} />
      <div className="grid gap-10 lg:grid-cols-2">
        <div>
          <Findings title="Needs attention" kind="risk" findings={s.findings} />
          <Findings title="Watch" kind="watch" findings={s.findings} />
          <Findings title="Going well" kind="win" findings={s.findings} />
          <h3 className="mb-2 mt-2 text-lg font-normal">Sales by category</h3>
          <BarList items={s.byCategory.map((r) => ({ key: r.key, label: r.name, value: r.amount, share: r.share }))} cur={cur} max={8} testId="category-bars" />
        </div>
        <div>
          <h3 className="mb-1 text-lg font-normal">Monthly sales, against the year before</h3>
          <LineChart labels={last12.map((t) => mshort(t.period))} cur={cur} height={260} testId="sales-trend"
            series={[
              { name: "Last 12 months", values: last12.map((t) => t.sales), color: C.s[0], fill: true },
              { name: "The 12 months before", values: prev12.map((t) => t.sales), color: C.mute, dashed: true, dots: false },
            ]} />
          <h3 className="mb-2 mt-8 text-lg font-normal">Largest customers</h3>
          <BarList items={s.byCustomer.filter((r) => r.amount > 0).map((r) => ({ key: r.key, label: r.name, value: r.amount, share: r.share }))} cur={cur} max={8} testId="customer-bars" />
        </div>
      </div>
      <DataNotes notes={s.notes} />
    </>
  );
}

function Reconciliation({ s, cur, checked }: { s: NonNullable<ReturnType<typeof useSalesAnalysis>>; cur: string; checked: number }) {
  if (!checked) return null;
  if (!s.unreconciled.length) {
    return (
      <p className="mb-8 flex items-start gap-2 rounded bg-green-bg px-4 py-2.5 text-[13px] text-green-d" data-testid="sales-reconciled">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />Sales agree with revenue in the P&amp;L for {checked === 1 ? "this month" : `all ${checked} months of this period`}.
      </p>
    );
  }
  return (
    <div className="mb-8 rounded bg-red-bg px-4 py-2.5 text-[13px] text-red" data-testid="sales-unreconciled">
      <div className="flex items-start gap-2 font-medium"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />Sales differ from revenue in the P&amp;L in {s.unreconciled.length} month{s.unreconciled.length > 1 ? "s" : ""}</div>
      <ul className="ml-6 mt-1 list-disc text-ink">
        {s.unreconciled.slice(0, 6).map((u) => <li key={u.period}>{mlabel(u.period)}: sales {money(u.sales, cur)}, revenue {money(u.revenue, cur)}, difference {money(u.diff, cur)}</li>)}
      </ul>
      <p className="ml-6 mt-1 text-ink">Usually revenue posted by journal entry rather than invoice, or a sales file covering different dates or excluding refunds. Analyses here use the sales lines; the Financials sector uses the P&amp;L.</p>
    </div>
  );
}

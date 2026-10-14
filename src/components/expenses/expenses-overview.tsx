"use client";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { mlabel, money, mshort, NOT_SUPPLIERS, pct, type ExpenseFlag } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { PageHeader } from "@/components/shell/page-header";
import { LineChart } from "@/components/charts/line-chart";
import { BarList } from "@/components/charts/bar-list";
import { C } from "@/components/charts/util";
import { ReadinessCard } from "@/components/setup/readiness-view";
import { CostBridge, costVs, DataNotes, ExpensesPicker, type ExpensesView, Findings, NoExpenses, NoLines, Tile, useExpensesAnalysis } from "./common";

export function ExpensesOverview() {
  const c = useCompany();
  const s = useExpensesAnalysis();
  const cur = c.settings.currency;
  if (!s) return <><PageHeader title="Expenses Overview" /><ReadinessCard sector="expenses" /><NoExpenses /></>;
  const last12 = s.trend.slice(-12), prev12 = s.trend.slice(0, 12);
  const top = s.byAccount[0];
  const headline = `${c.name} spent ${money(s.total, cur)} in ${s.window.label}${s.growth !== null ? `, ${s.growth >= 0 ? "up" : "down"} ${Math.abs(s.growth).toFixed(1)}% on ${s.compareLabel}` : ""}${s.ofSales !== null ? `: ${pct(s.ofSales, 0)} of sales` : ""}${top ? `. The largest cost is ${top.name} (${pct(top.share, 0)})` : ""}.`;
  const cn = s.concentration;
  return (
    <>
      <PageHeader title="Expenses Overview" right={<ExpensesPicker s={s} />} />
      <ReadinessCard sector="expenses" />
      <p className="fade-up mb-6 max-w-4xl text-[17px] leading-relaxed" data-testid="expenses-headline">{headline}</p>
      <div className="mb-8 grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
        <Tile label="Total costs" value={money(s.total, cur)} sub={costVs(s.growth, s.compareLabel)} neg={(s.growth ?? 0) > 0} testId="tile-costs" />
        <Tile label="Costs as % of sales" value={s.ofSales === null ? "–" : pct(s.ofSales, 1)} sub={<span className="text-mute">{s.ofSalesCompare === null ? "of net sales" : `was ${pct(s.ofSalesCompare, 1)}`}</span>} neg={s.ofSales !== null && s.ofSalesCompare !== null && s.ofSales > s.ofSalesCompare} testId="tile-of-sales" />
        <Tile label="Fixed costs" value={money(s.split.fixed, cur)} sub={<span className="text-mute">{s.total ? `${pct((s.split.fixed / s.total) * 100, 0)} of costs · variable ${pct((s.split.variable / s.total) * 100, 0)}` : ""}</span>} testId="tile-fixed" />
        <Tile label="Top 5 suppliers" value={cn.top5Share === null ? "–" : pct(cn.top5Share, 0)} sub={<span className="text-mute">{cn.topName ? `${cn.suppliers} suppliers paid` : "needs expense lines"}</span>} neg={(cn.topShare ?? 0) > 25} testId="tile-suppliers" />
      </div>
      <Reconciliation s={s} cur={cur} />
      <div className="grid gap-10 lg:grid-cols-2">
        <div>
          <Findings title="Needs attention" kind="risk" findings={s.findings} />
          <Findings title="Watch" kind="watch" findings={s.findings} />
          <Findings title="Going well" kind="win" findings={s.findings} />
          {s.compare !== null && s.bridge.length > 0 && <>
            <h3 className="mb-2 mt-2 text-lg font-normal">What changed since {s.compareLabel}</h3>
            <CostBridge s={s} cur={cur} />
          </>}
          <h3 className="mb-2 mt-8 text-lg font-normal">Costs by type</h3>
          <BarList items={s.byGroup.map((r) => ({ key: r.key, label: r.name, value: r.amount, share: r.share }))} cur={cur} max={8} testId="group-bars" />
        </div>
        <div>
          <h3 className="mb-1 text-lg font-normal">Monthly costs, against the year before</h3>
          <LineChart labels={last12.map((t) => mshort(t.period))} cur={cur} height={260} testId="expenses-trend"
            series={[
              { name: "Last 12 months", values: last12.map((t) => t.total), color: C.s[1], fill: true },
              { name: "The 12 months before", values: prev12.map((t) => t.total), color: C.mute, dashed: true, dots: false },
            ]} />
          <h3 className="mb-2 mt-8 text-lg font-normal">Largest suppliers</h3>
          {s.lines.has
            ? <BarList items={s.bySupplier.filter((r) => r.amount > 0 && !NOT_SUPPLIERS.has(r.key)).map((r) => ({ key: r.key, label: r.name, value: r.amount, share: r.share }))} cur={cur} max={8} testId="supplier-bars" />
            : <NoLines compact />}
          <CheckThese s={s} cur={cur} />
        </div>
      </div>
      <DataNotes notes={s.notes} />
    </>
  );
}

function Reconciliation({ s, cur }: { s: ExpensesView; cur: string }) {
  const checked = s.trend.filter((t) => s.window.periods.includes(t.period) && t.lines !== null && t.total !== null).length;
  if (!checked) return null;
  if (!s.unreconciled.length) {
    return (
      <p className="mb-8 flex items-start gap-2 rounded bg-green-bg px-4 py-2.5 text-[13px] text-green-d" data-testid="expenses-reconciled">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />The expense lines agree with the costs in the P&amp;L for {checked === 1 ? "this month" : `all ${checked} months of this period`}.
      </p>
    );
  }
  return (
    <div className="mb-8 rounded bg-amber/10 px-4 py-2.5 text-[13px]" data-testid="expenses-unreconciled">
      <div className="flex items-start gap-2 font-medium"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#9a6b00]" />The expense lines differ from P&amp;L costs in {s.unreconciled.length} month{s.unreconciled.length > 1 ? "s" : ""}</div>
      <ul className="ml-6 mt-1 list-disc">
        {s.unreconciled.slice(0, 6).map((u) => <li key={u.period}>{mlabel(u.period)}: lines {money(u.lines, cur)}, P&amp;L {money(u.costs, cur)}, difference {money(u.diff, cur)}</li>)}
      </ul>
      <p className="ml-6 mt-1 text-mute">A vendor bills file holds bills only: salaries, rent paid by bank and depreciation are not in it. Totals on this page use the P&amp;L.</p>
    </div>
  );
}

/** Large entries and possible double payments in the period. */
export function CheckThese({ s, cur }: { s: ExpensesView; cur: string }) {
  if (!s.large.length && !s.doubles.length) return null;
  const when = (f: ExpenseFlag, d = f.d) => (d ? d.split("-").reverse().join("/") : mlabel(f.p));
  return (
    <div className="mt-8" data-testid="check-these">
      <h3 className="mb-2 text-lg font-normal">Check these</h3>
      <ul className="space-y-2 text-[13px]">
        {s.doubles.slice(0, 5).map((f, i) => (
          <li key={`d${i}`} className="border-l-[3px] border-red bg-band px-3 py-2" data-testid="flag-double">
            <b className="font-semibold">Paid twice?</b> {f.s}: {money(f.a, cur)} on {when(f)} ({f.doc || "no number"}) and {when(f, f.d2)} ({f.doc2 || "no number"}).
          </li>
        ))}
        {s.large.slice(0, 5).map((f, i) => (
          <li key={`l${i}`} className="border-l-[3px] border-amber bg-band px-3 py-2" data-testid="flag-large">
            <b className="font-semibold">Large entry.</b> {f.t}: {money(f.a, cur)} on {when(f)}{f.s && !/^(No supplier|Journal entries)$/.test(f.s) ? ` from ${f.s}` : ""}. A usual month is {money(f.m ?? 0, cur)}.
          </li>
        ))}
      </ul>
    </div>
  );
}

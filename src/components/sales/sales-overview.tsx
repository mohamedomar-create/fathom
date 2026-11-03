"use client";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { money, pct } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { PageHeader } from "@/components/shell/page-header";
import { LineChart } from "@/components/charts/line-chart";
import { BarList } from "@/components/charts/bar-list";
import { C } from "@/components/charts/util";
import { compact } from "@/lib/engine/format";
import { Cockpit, HeroKpi } from "@/components/viz/kpi";
import { CardGrid, ChartCard } from "@/components/viz/chart-card";
import { ParetoList } from "@/components/viz/pareto";
import { Treemap } from "@/components/viz/treemap";
import { HeatCalendar } from "@/components/viz/heat-calendar";
import { DataNotes, Findings, FromAccountsNote, NoSales, SalesTile, useSalesAnalysis, SalesPicker } from "./common";
import { ReadinessCard } from "@/components/setup/readiness-view";
import { useT } from "@/lib/i18n/use-t";

export function SalesOverview() {
  const c = useCompany();
  const s = useSalesAnalysis();
  const T = useT();
  const t = T.d.sales;
  const V = T.d.viz;
  const title = T.d.nav.sales[1];
  const cur = c.settings.currency;
  if (!s) return <><PageHeader title={title} /><ReadinessCard sector="sales" /><NoSales /></>;
  const cu = s.customers;
  const last12 = s.trend.slice(-12);
  const prev12 = s.trend.slice(0, 12);
  const checked = s.trend.filter((t) => s.window.periods.includes(t.period) && t.sales !== null && t.revenue !== null).length;
  const growth = s.growth !== null ? t.growthPart(s.growth >= 0, Math.abs(s.growth).toFixed(1), t.word[s.compareLabel] ?? s.compareLabel) : null;
  const headline = s.fromAccounts
    ? t.headlineAcc(c.name, money(s.total, cur), T.pl(s.window.label), growth)
    : t.headline(c.name, money(s.total, cur), T.pl(s.window.label), growth, s.invoices, cu.active, s.byCategory[0] ? t.catPart(T.tl(s.byCategory[0].name), pct(s.byCategory[0].share, 0)) : null);
  return (
    <>
      <PageHeader title={title} right={<SalesPicker s={s} />} />
      <ReadinessCard sector="sales" />
      {s.fromAccounts && <FromAccountsNote />}
      <Cockpit hero={
        <HeroKpi label={t.netSales} testId="tile-sales" value={money(s.total, cur, true)} neg={s.total < 0}
          delta={s.growth} deltaLabel={s.compareLabel ? t.vs(t.word[s.compareLabel] ?? s.compareLabel) : t.noComparison}
          now={last12.map((x) => x.sales)} last={prev12.map((x) => x.sales)}
          story={<span data-testid="sales-headline">{headline}</span>} />
      }>
        <SalesTile label={t.invoices} value={s.fromAccounts ? "–" : s.invoices.toLocaleString("en-US")} sub={s.fromAccounts ? t.needsLines : s.creditNotes ? `${t.creditNotes(s.creditNotes)} · ${t.lines(s.lines)}` : t.lines(s.lines)} />
        <SalesTile label={t.avgInvoice} value={s.avgInvoice === null ? "–" : money(s.avgInvoice, cur, true)} sub={t.netOfTax} />
        <SalesTile label={t.active} value={s.fromAccounts ? "–" : cu.active.toLocaleString("en-US")} sub={s.fromAccounts ? t.needsLines : cu.new === null ? t.newNeedEarlier : t.newReturning(cu.new, cu.returning ?? 0)} />
        <SalesTile label={t.top10} value={cu.top10Share === null ? "–" : pct(cu.top10Share, 0)} sub={cu.topName ? t.largest(pct(cu.topShare ?? 0, 0)) : t.ofSales} neg={(cu.topShare ?? 0) > 20} />
        <SalesTile label={t.grossMargin} value={s.margin === null ? "–" : pct(s.margin, 1)} sub={s.margin === null ? t.needsCost : t.costKnown(pct(s.costCoverage, 0))} />
      </Cockpit>
      <Reconciliation s={s} cur={cur} checked={checked} />
      <CardGrid>
        <ChartCard title={t.monthly} wide testId="card-sales-trend"
          table={{ head: [V.month, t.last12, t.prev12], rows: last12.map((x, i) => [T.ml(x.period), money(x.sales, cur), money(prev12[i]?.sales ?? null, cur)]) }}>
          <LineChart labels={last12.map((x) => T.ms(x.period))} cur={cur} height={260} testId="sales-trend"
            series={[
              { name: t.last12, values: last12.map((x) => x.sales), color: C.s[0], fill: true },
              { name: t.prev12, values: prev12.map((x) => x.sales), color: C.mute, dashed: true, dots: false },
            ]} />
        </ChartCard>
        <ChartCard title={s.fromAccounts ? t.byAccount : V.mod.mix} sub={V.mod.mixSub} testId="card-sales-mix">
          <Treemap cur={cur} height={240} testId="sales-treemap" items={(s.fromAccounts ? s.byProduct : s.byCategory).map((r) => ({ key: r.key, label: T.tl(r.name), value: r.amount }))} />
          <div className="mt-4"><BarList items={(s.fromAccounts ? s.byProduct : s.byCategory).map((r) => ({ key: r.key, label: T.tl(r.name), value: r.amount, share: r.share }))} cur={cur} max={6} testId="category-bars" /></div>
        </ChartCard>
        {!s.fromAccounts ? (
          <ChartCard title={V.mod.customerPareto} sub={V.mod.customerParetoSub} testId="card-customer-pareto">
            <ParetoList cur={cur} max={10} testId="customer-pareto" items={s.byCustomer.map((r) => ({ key: r.key, label: r.name, value: r.amount }))} />
          </ChartCard>
        ) : null}
        <ChartCard title={V.mod.salesByMonth} sub={V.mod.salesByMonthSub} wide testId="card-sales-heat">
          <HeatCalendar periods={s.trend.map((x) => x.period)} values={s.trend.map((x) => x.sales)} fmt={(v) => compact(v, T.lang === "ar" ? "ar" : "en")} label={V.mod.salesByMonth} />
        </ChartCard>
      </CardGrid>
      <div className="grid gap-x-8 lg:grid-cols-3">
        <Findings title={t.risk} kind="risk" findings={s.findings} />
        <Findings title={t.watch} kind="watch" findings={s.findings} />
        <Findings title={t.win} kind="win" findings={s.findings} />
      </div>
      <DataNotes notes={s.notes} />
    </>
  );
}

function Reconciliation({ s, cur, checked }: { s: NonNullable<ReturnType<typeof useSalesAnalysis>>; cur: string; checked: number }) {
  const T = useT();
  const t = T.d.sales;
  if (!checked) return null;
  if (!s.unreconciled.length) {
    return (
      <p className="mb-8 flex items-start gap-2 rounded bg-green-bg px-4 py-2.5 text-[13px] text-green-d" data-testid="sales-reconciled">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{t.reconciled(checked)}
      </p>
    );
  }
  return (
    <div className="mb-8 rounded bg-red-bg px-4 py-2.5 text-[13px] text-red" data-testid="sales-unreconciled">
      <div className="flex items-start gap-2 font-medium"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />{t.unreconciled(s.unreconciled.length)}</div>
      <ul className="ms-6 mt-1 list-disc text-ink">
        {s.unreconciled.slice(0, 6).map((u) => <li key={u.period}>{t.unreconciledLine(T.ml(u.period), money(u.sales, cur), money(u.revenue, cur), money(u.diff, cur))}</li>)}
      </ul>
      <p className="ms-6 mt-1 text-ink">{t.unreconciledWhy}</p>
    </div>
  );
}

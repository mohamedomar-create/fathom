"use client";
import { useMemo } from "react";
import { useExpenses } from "@/lib/company/expenses-context";
import { expenseTotals } from "@/lib/crosscheck";
import { AgreesStrip } from "@/components/modules/agrees-strip";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { isLender, lenderName, money, notSupplier, pct, type ExpenseFlag } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { PageHeader } from "@/components/shell/page-header";
import { LineChart } from "@/components/charts/line-chart";
import { BarList } from "@/components/charts/bar-list";
import { C } from "@/components/charts/util";
import { ramp } from "@/components/viz/palette";
import { ColumnChart } from "@/components/charts/column-chart";
import { compact } from "@/lib/engine/format";
import { Cockpit, HeroKpi } from "@/components/viz/kpi";
import { CardGrid, ChartCard } from "@/components/viz/chart-card";
import { ParetoList } from "@/components/viz/pareto";
import { Treemap } from "@/components/viz/treemap";
import { HeatCalendar } from "@/components/viz/heat-calendar";
import { ReadinessCard } from "@/components/setup/readiness-view";
import { useT } from "@/lib/i18n/use-t";
import { CostBridge, DataNotes, ExpensesPicker, type ExpensesView, Findings, LenderTable, NoExpenses, NoLines, Tile, useExpensesAnalysis } from "./common";

export function ExpensesOverview() {
  const c = useCompany();
  const s = useExpensesAnalysis();
  const T = useT();
  const t = T.d.exp;
  const title = T.d.nav.expenses[1];
  const cur = c.settings.currency;
  if (!s) return <><PageHeader title={title} /><ReadinessCard sector="expenses" /><NoExpenses /></>;
  const last12 = s.trend.slice(-12), prev12 = s.trend.slice(0, 12);
  const top = s.byAccount[0];
  const headline = t.headline(c.name, money(s.total, cur), T.pl(s.window.label), s.growth !== null ? T.d.sales.growthPart(s.growth >= 0, Math.abs(s.growth).toFixed(1), T.d.sales.word[s.compareLabel] ?? s.compareLabel) : null, s.ofSales !== null ? pct(s.ofSales, 0) : null, top ? `${T.tl(top.name)} (${pct(top.share, 0)})` : null);
  const cn = s.concentration;
  const V = T.d.viz;
  // The largest cost groups over the last 12 months, in a fixed order, so each keeps its colour from month to month.
  const groupTotals = new Map<string, number>();
  for (const x of last12) for (const [g, v] of Object.entries(x.groups)) groupTotals.set(g, (groupTotals.get(g) ?? 0) + v);
  const positiveGroups = [...groupTotals.values()].filter((v) => v > 0).length;
  const groupName = new Map(s.byGroup.map((r) => [r.key, r.name]));
  const gl = (g: string) => T.tl(groupName.get(g) ?? g);
  const groups = [...groupTotals.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([g]) => g);
  return (
    <>
      <PageHeader title={title} right={<ExpensesPicker s={s} />} />
      <ReadinessCard sector="expenses" />
      <ExpensesAgree />
      <Cockpit hero={
        <HeroKpi label={t.totalCosts} testId="tile-costs" value={money(s.total, cur)} cost
          delta={s.growth} deltaLabel={s.compareLabel ? T.d.sales.vs(T.d.sales.word[s.compareLabel] ?? s.compareLabel) : T.d.sales.noComparison}
          now={last12.map((x) => x.total)} last={prev12.map((x) => x.total)}
          story={<span data-testid="expenses-headline">{headline}</span>} />
      }>
        <Tile label={t.ofSales} value={s.ofSales === null ? "–" : pct(s.ofSales, 1)} sub={s.ofSalesCompare === null ? t.ofNetSales : t.was(pct(s.ofSalesCompare, 1))} neg={s.ofSales !== null && s.ofSalesCompare !== null && s.ofSales > s.ofSalesCompare} testId="tile-of-sales" now={last12.map((x) => x.ofSales)} />
        <Tile label={t.fixed} value={money(s.split.fixed, cur, true)} sub={s.total ? t.fixedSub(pct((s.split.fixed / s.total) * 100, 0), pct((s.split.variable / s.total) * 100, 0)) : ""} testId="tile-fixed" />
        <Tile label={t.top5} value={cn.top5Share === null ? "–" : pct(cn.top5Share, 0)} sub={cn.topName ? t.suppliersPaid(cn.suppliers) : t.needsLines} neg={(cn.topShare ?? 0) > 25} testId="tile-suppliers" />
        {s.finance.total > 0 && <Tile label={t.banksTitle} value={money(s.finance.total, cur, true)} />}
      </Cockpit>
      <Reconciliation s={s} cur={cur} />
      <CardGrid>
        <ChartCard title={t.monthly} wide testId="card-exp-trend"
          table={{ head: [V.month, T.d.sales.last12, T.d.sales.prev12], rows: last12.map((x, i) => [T.ml(x.period), money(x.total, cur), money(prev12[i]?.total ?? null, cur)]) }}>
          <LineChart labels={last12.map((x) => T.ms(x.period))} cur={cur} height={260} testId="expenses-trend"
            series={[
              { name: T.d.sales.last12, values: last12.map((x) => x.total), color: C.s[1], fill: true },
              { name: T.d.sales.prev12, values: prev12.map((x) => x.total), color: C.mute, dashed: true, dots: false },
            ]} />
        </ChartCard>
        <ChartCard title={V.mod.costMix} sub={V.mod.costMixSub} testId="card-cost-mix">
          <Treemap cur={cur} height={220} items={s.byGroup.map((r) => ({ key: r.key, label: T.tl(r.name), value: r.amount }))} />
          <div className="mt-4"><BarList items={s.byGroup.map((r) => ({ key: r.key, label: T.tl(r.name), value: r.amount, share: r.share }))} cur={cur} max={6} testId="group-bars" /></div>
        </ChartCard>
        {s.compare !== null && s.bridge.length > 0 ? (
          <ChartCard title={t.whatChanged(T.d.sales.word[s.compareLabel] ?? s.compareLabel)} testId="card-cost-bridge">
            <CostBridge s={s} cur={cur} />
          </ChartCard>
        ) : null}
        {groups.length > 0 && (
          <ChartCard title={t.byType} wide testId="card-exp-groups"
            table={{ head: [V.month, ...groups.map(gl)], rows: last12.map((x) => [T.ml(x.period), ...groups.map((g) => money(x.groups[g] ?? 0, cur))]) }}>
            <ColumnChart stacked cur={cur} height={260} labels={last12.map((x) => T.ms(x.period))}
              series={[
                ...groups.map((g, i) => ({ name: gl(g), values: last12.map((x) => (x.total === null ? null : x.groups[g] ?? 0)), color: ramp(groups.length)[i] })),
                ...(positiveGroups > groups.length ? [{ name: V.other(positiveGroups - groups.length), values: last12.map((x) => (x.total === null ? null : Math.max(0, x.total - groups.reduce((t, g) => t + (x.groups[g] ?? 0), 0)))), color: C.mute }] : []),
              ]} />
          </ChartCard>
        )}
        <ChartCard title={V.mod.supplierPareto} sub={V.mod.supplierParetoSub} testId="card-supplier-pareto">
          {s.lines.has
            ? <ParetoList cur={cur} max={10} testId="supplier-bars" items={s.bySupplier.filter((r) => r.amount > 0 && !notSupplier(r.key)).map((r) => ({ key: r.key, label: r.name, value: r.amount }))} />
            : <NoLines compact />}
        </ChartCard>
        {s.byLender.length > 0 && (
          <ChartCard title={t.banksTitle} testId="card-lenders"><div tabIndex={0} className="overflow-x-auto"><LenderTable s={s} cur={cur} testId="lender-table-overview" /></div></ChartCard>
        )}
        <ChartCard title={V.mod.costByMonth} sub={V.mod.costByMonthSub} wide testId="card-cost-heat">
          <HeatCalendar periods={s.trend.map((x) => x.period)} values={s.trend.map((x) => x.total)} fmt={(v) => compact(v, T.lang === "ar" ? "ar" : "en")} label={V.mod.costByMonth} />
        </ChartCard>
      </CardGrid>
      <div className="grid gap-x-8 lg:grid-cols-3">
        <Findings title={T.d.sales.risk} kind="risk" findings={s.findings} />
        <Findings title={T.d.sales.watch} kind="watch" findings={s.findings} />
        <Findings title={T.d.sales.win} kind="win" findings={s.findings} />
      </div>
      <CheckThese s={s} cur={cur} />
      <DataNotes notes={s.notes} />
    </>
  );
}

function Reconciliation({ s, cur }: { s: ExpensesView; cur: string }) {
  const T = useT();
  const t = T.d.exp;
  if (!s.reconcilable) return <p className="mb-8 text-[13px] text-mute" data-testid="expenses-not-checked">{t.notReconciled}</p>;
  const checked = s.trend.filter((t) => s.window.periods.includes(t.period) && t.lines !== null && t.total !== null).length;
  if (!checked) return null;
  if (!s.unreconciled.length) {
    return (
      <p className="mb-8 flex items-start gap-2 rounded bg-green-bg px-4 py-2.5 text-[13px] text-green-d" data-testid="expenses-reconciled">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{t.reconciled(checked)}
      </p>
    );
  }
  return (
    <div className="mb-8 rounded bg-amber/10 px-4 py-2.5 text-[13px]" data-testid="expenses-unreconciled">
      <div className="flex items-start gap-2 font-medium"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#7d5600]" />{t.unreconciled(s.unreconciled.length)}</div>
      <ul className="ms-6 mt-1 list-disc">
        {s.unreconciled.slice(0, 6).map((u) => <li key={u.period}>{t.unreconciledLine(T.ml(u.period), money(u.lines, cur), money(u.costs, cur), money(u.diff, cur))}</li>)}
      </ul>
      <p className="ms-6 mt-1 text-mute">{t.unreconciledWhy}</p>
    </div>
  );
}

/** Large entries and possible double payments in the period. */
export function CheckThese({ s, cur }: { s: ExpensesView; cur: string }) {
  const T = useT();
  const t = T.d.exp;
  if (!s.large.length && !s.doubles.length) return null;
  const when = (f: ExpenseFlag, d = f.d) => (d ? d.split("-").reverse().join("/") : T.ml(f.p));
  return (
    <div className="mt-8" data-testid="check-these">
      <h3 className="mb-2 text-lg font-semibold">{t.checkThese}</h3>
      <ul className="space-y-2 text-[13px]">
        {s.doubles.slice(0, 5).map((f, i) => (
          <li key={`d${i}`} className="border-s-[3px] border-red bg-band px-3 py-2" data-testid="flag-double">
            <b className="font-semibold">{t.paidTwice}</b>{t.twiceLine(f.s, money(f.a, cur), when(f), f.doc || t.noNumber, when(f, f.d2), f.doc2 || t.noNumber)}
          </li>
        ))}
        {s.large.slice(0, 5).map((f, i) => (
          <li key={`l${i}`} className="border-s-[3px] border-amber bg-band px-3 py-2" data-testid="flag-large">
            <b className="font-semibold">{t.largeEntry}</b>{t.largeLine(f.t, money(f.a, cur), when(f), f.s && isLender(f.s) ? ` (${T.tl(lenderName(f.s))})` : f.s && !notSupplier(f.s) ? t.from(f.s) : "", money(f.m ?? 0, cur))}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The expense lines checked against the cost accounts, by month. */
function ExpensesAgree() {
  const data = useExpenses();
  const input = useMemo(() => ({ expenses: expenseTotals(data), generic: [] }), [data]);
  return <AgreesStrip input={input} />;
}

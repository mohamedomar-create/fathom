"use client";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { isLender, lenderName, money, notSupplier, pct, type ExpenseFlag } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { PageHeader } from "@/components/shell/page-header";
import { LineChart } from "@/components/charts/line-chart";
import { BarList } from "@/components/charts/bar-list";
import { C } from "@/components/charts/util";
import { ReadinessCard } from "@/components/setup/readiness-view";
import { useT } from "@/lib/i18n/use-t";
import { CostBridge, costVs, DataNotes, ExpensesPicker, type ExpensesView, Findings, LenderTable, NoExpenses, NoLines, Tile, useExpensesAnalysis } from "./common";

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
  return (
    <>
      <PageHeader title={title} right={<ExpensesPicker s={s} />} />
      <ReadinessCard sector="expenses" />
      <p className="fade-up mb-6 max-w-4xl text-[17px] leading-relaxed" data-testid="expenses-headline">{headline}</p>
      <div className="mb-8 grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
        <Tile label={t.totalCosts} value={money(s.total, cur)} sub={costVs(s.growth, s.compareLabel)} neg={(s.growth ?? 0) > 0} testId="tile-costs" />
        <Tile label={t.ofSales} value={s.ofSales === null ? "–" : pct(s.ofSales, 1)} sub={<span className="text-mute">{s.ofSalesCompare === null ? t.ofNetSales : t.was(pct(s.ofSalesCompare, 1))}</span>} neg={s.ofSales !== null && s.ofSalesCompare !== null && s.ofSales > s.ofSalesCompare} testId="tile-of-sales" />
        <Tile label={t.fixed} value={money(s.split.fixed, cur)} sub={<span className="text-mute">{s.total ? t.fixedSub(pct((s.split.fixed / s.total) * 100, 0), pct((s.split.variable / s.total) * 100, 0)) : ""}</span>} testId="tile-fixed" />
        <Tile label={t.top5} value={cn.top5Share === null ? "–" : pct(cn.top5Share, 0)} sub={<span className="text-mute">{cn.topName ? t.suppliersPaid(cn.suppliers) : t.needsLines}</span>} neg={(cn.topShare ?? 0) > 25} testId="tile-suppliers" />
      </div>
      <Reconciliation s={s} cur={cur} />
      <div className="grid gap-10 lg:grid-cols-2">
        <div className="min-w-0">
          <Findings title={T.d.sales.risk} kind="risk" findings={s.findings} />
          <Findings title={T.d.sales.watch} kind="watch" findings={s.findings} />
          <Findings title={T.d.sales.win} kind="win" findings={s.findings} />
          {s.compare !== null && s.bridge.length > 0 && <>
            <h3 className="mb-2 mt-2 text-lg font-normal">{t.whatChanged(T.d.sales.word[s.compareLabel] ?? s.compareLabel)}</h3>
            <CostBridge s={s} cur={cur} />
          </>}
          <h3 className="mb-2 mt-8 text-lg font-normal">{t.byType}</h3>
          <BarList items={s.byGroup.map((r) => ({ key: r.key, label: T.tl(r.name), value: r.amount, share: r.share }))} cur={cur} max={8} testId="group-bars" />
          {s.byLender.length > 0 && <>
            <h3 className="mb-2 mt-8 text-lg font-normal">{t.banksTitle}</h3>
            <LenderTable s={s} cur={cur} testId="lender-table-overview" />
          </>}
        </div>
        <div>
          <h3 className="mb-1 text-lg font-normal">{t.monthly}</h3>
          <LineChart labels={last12.map((x) => T.ms(x.period))} cur={cur} height={260} testId="expenses-trend"
            series={[
              { name: T.d.sales.last12, values: last12.map((x) => x.total), color: C.s[1], fill: true },
              { name: T.d.sales.prev12, values: prev12.map((x) => x.total), color: C.mute, dashed: true, dots: false },
            ]} />
          <h3 className="mb-2 mt-8 text-lg font-normal">{t.largestSuppliers}</h3>
          {s.lines.has
            ? <BarList items={s.bySupplier.filter((r) => r.amount > 0 && !notSupplier(r.key)).map((r) => ({ key: r.key, label: r.name, value: r.amount, share: r.share }))} cur={cur} max={8} testId="supplier-bars" />
            : <NoLines compact />}
          <CheckThese s={s} cur={cur} />
        </div>
      </div>
      <DataNotes notes={s.notes} />
    </>
  );
}

function Reconciliation({ s, cur }: { s: ExpensesView; cur: string }) {
  const T = useT();
  const t = T.d.exp;
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
      <div className="flex items-start gap-2 font-medium"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#9a6b00]" />{t.unreconciled(s.unreconciled.length)}</div>
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
      <h3 className="mb-2 text-lg font-normal">{t.checkThese}</h3>
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

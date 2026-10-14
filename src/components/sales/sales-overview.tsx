"use client";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { money, pct } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { PageHeader } from "@/components/shell/page-header";
import { LineChart } from "@/components/charts/line-chart";
import { BarList } from "@/components/charts/bar-list";
import { C } from "@/components/charts/util";
import { DataNotes, Findings, FromAccountsNote, NoSales, SalesTile, useSalesAnalysis, vs, SalesPicker } from "./common";
import { ReadinessCard } from "@/components/setup/readiness-view";
import { useT } from "@/lib/i18n/use-t";

export function SalesOverview() {
  const c = useCompany();
  const s = useSalesAnalysis();
  const T = useT();
  const t = T.d.sales;
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
      <p className="fade-up mb-6 max-w-4xl text-[17px] leading-relaxed" data-testid="sales-headline">{headline}</p>
      <div className="mb-8 grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-3 xl:grid-cols-6">
        <SalesTile label={t.netSales} value={money(s.total, cur)} sub={vs(s.growth, s.compareLabel)} neg={s.total < 0 || (s.growth ?? 0) < 0} testId="tile-sales" />
        <SalesTile label={t.invoices} value={s.fromAccounts ? "–" : s.invoices.toLocaleString("en-US")} sub={<span className="text-mute">{s.fromAccounts ? t.needsLines : t.lines(s.lines)}</span>} />
        <SalesTile label={t.avgInvoice} value={s.avgInvoice === null ? "–" : money(s.avgInvoice, cur)} sub={<span className="text-mute">{t.netOfTax}</span>} />
        <SalesTile label={t.active} value={s.fromAccounts ? "–" : cu.active.toLocaleString("en-US")} sub={<span className="text-mute">{s.fromAccounts ? t.needsLines : cu.new === null ? t.newNeedEarlier : t.newReturning(cu.new, cu.returning ?? 0)}</span>} />
        <SalesTile label={t.top10} value={cu.top10Share === null ? "–" : pct(cu.top10Share, 0)} sub={<span className="text-mute">{cu.topName ? t.largest(pct(cu.topShare ?? 0, 0)) : t.ofSales}</span>} neg={(cu.topShare ?? 0) > 20} />
        <SalesTile label={t.grossMargin} value={s.margin === null ? "–" : pct(s.margin, 1)} sub={<span className="text-mute">{s.margin === null ? t.needsCost : t.costKnown(pct(s.costCoverage, 0))}</span>} />
      </div>
      <Reconciliation s={s} cur={cur} checked={checked} />
      <div className="grid gap-10 lg:grid-cols-2">
        <div>
          <Findings title={t.risk} kind="risk" findings={s.findings} />
          <Findings title={t.watch} kind="watch" findings={s.findings} />
          <Findings title={t.win} kind="win" findings={s.findings} />
          <h3 className="mb-2 mt-2 text-lg font-normal">{s.fromAccounts ? t.byAccount : t.byCategory}</h3>
          <BarList items={(s.fromAccounts ? s.byProduct : s.byCategory).map((r) => ({ key: r.key, label: T.tl(r.name), value: r.amount, share: r.share }))} cur={cur} max={8} testId="category-bars" />
        </div>
        <div>
          <h3 className="mb-1 text-lg font-normal">{t.monthly}</h3>
          <LineChart labels={last12.map((x) => T.ms(x.period))} cur={cur} height={260} testId="sales-trend"
            series={[
              { name: t.last12, values: last12.map((x) => x.sales), color: C.s[0], fill: true },
              { name: t.prev12, values: prev12.map((x) => x.sales), color: C.mute, dashed: true, dots: false },
            ]} />
          {!s.fromAccounts && <>
            <h3 className="mb-2 mt-8 text-lg font-normal">{t.largestCustomers}</h3>
            <BarList items={s.byCustomer.filter((r) => r.amount > 0).map((r) => ({ key: r.key, label: T.tl(r.name), value: r.amount, share: r.share }))} cur={cur} max={8} testId="customer-bars" />
          </>}
        </div>
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

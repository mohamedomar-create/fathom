"use client";
import { money } from "@/lib/engine";
import { inventoryMonthly } from "@/lib/engine/inventory";
import { useCompany } from "@/lib/company/context";
import { useInventory } from "@/lib/company/inventory-context";
import { PageHeader } from "@/components/shell/page-header";
import { LineChart } from "@/components/charts/line-chart";
import { BarList } from "@/components/charts/bar-list";
import { C } from "@/components/charts/util";
import { Cockpit, HeroKpi } from "@/components/viz/kpi";
import { CardGrid, ChartCard } from "@/components/viz/chart-card";
import { Treemap } from "@/components/viz/treemap";
import { ReadinessCard } from "@/components/setup/readiness-view";
import { useT } from "@/lib/i18n/use-t";
import { Findings, InventoryPicker, NoInventory, StockBridge, TieBanner, Tile, useInventoryAnalysis } from "./common";

export function InventoryOverview() {
  const c = useCompany();
  const d = useInventory();
  const s = useInventoryAnalysis();
  const T = useT();
  const t = T.d.inv;
  const title = T.d.nav.inventory[1];
  const cur = c.settings.currency;
  if (!s) return <><PageHeader title={title} /><ReadinessCard sector="inventory" /><NoInventory /></>;
  const tl = s.tiles;
  const monthly = s.hasValue ? inventoryMonthly(d, s.end, 12) : [];
  return (
    <>
      <PageHeader title={title} right={<InventoryPicker s={s} />} />
      <ReadinessCard sector="inventory" />
      <Cockpit testId="inv-tiles" hero={
        <HeroKpi label={t.value} testId="tile-stock-value" value={tl.value === null ? "–" : money(tl.value, cur, true)}
          deltaLabel={tl.value === null ? t.needsValuation : s.label}
          delta={monthly.length > 1 && monthly[monthly.length - 2].closing ? ((monthly[monthly.length - 1].closing - monthly[monthly.length - 2].closing) / Math.abs(monthly[monthly.length - 2].closing)) * 100 : undefined}
          now={monthly.length > 1 ? monthly.map((x) => x.closing) : undefined}
          story={<span data-testid="inv-headline">{s.headline}</span>} />
      }>
        <Tile label={t.days} value={tl.days === null ? "–" : String(tl.days)} sub={t.daysSub} neg={(tl.days ?? 0) > 120} testId="tile-stock-days" />
        <Tile label={t.cogs} value={tl.cogs === null ? "–" : money(tl.cogs, cur, true)} sub={t.cogsSub} testId="tile-stock-cogs" now={monthly.length > 1 ? monthly.map((x) => x.cogs) : undefined} />
        <Tile label={t.slow} value={tl.slow === null || tl.dead === null ? "–" : money(tl.slow + tl.dead, cur, true)} sub={tl.dead === null ? t.needsValuation : t.slowSub(money(tl.dead, cur))} neg={(tl.slow ?? 0) + (tl.dead ?? 0) > 0} testId="tile-stock-slow" />
        {s.position && tl.value && s.position.rental > 0 ? <Tile label={t.onRental} value={money(s.position.rental, cur, true)} sub={`${Math.round((s.position.rental / tl.value) * 100)}% · ${T.ml(s.position.at)}`} /> : null}
      </Cockpit>
      <TieBanner s={s} link={`${c.basePath}/inventory/valuation`} />
      <CardGrid>
        {monthly.length > 0 && (
          <ChartCard title={t.valueVsCogs} wide testId="card-inv-trend"
            table={{ head: [T.d.viz.month, t.value, t.cogs], rows: monthly.map((x) => [T.ml(x.p), money(x.closing, cur), money(x.cogs, cur)]) }}>
            <LineChart labels={monthly.map((x) => T.ms(x.p))} cur={cur} height={260} testId="inv-trend"
              series={[
                { name: t.value, values: monthly.map((x) => x.closing), color: C.s[0], fill: true },
                { name: t.cogs, values: monthly.map((x) => x.cogs), color: C.s[1], dots: false },
              ]} />
          </ChartCard>
        )}
        {s.bridge && <ChartCard title={t.howMoved} testId="card-inv-bridge"><StockBridge b={s.bridge} cur={cur} /></ChartCard>}
        {s.position && (
          <ChartCard title={t.whereTitle} sub={T.ml(s.position.at)} testId="inv-position">
            <span className="sr-only" data-testid="inv-position-at">{T.ml(s.position.at)}</span>
            <BarList items={[
              { key: "warehouse", label: t.inWarehouses, value: s.position.warehouse, share: tl.value ? (s.position.warehouse / tl.value) * 100 : undefined },
              { key: "rental", label: t.onRental, value: s.position.rental, share: tl.value ? (s.position.rental / tl.value) * 100 : undefined },
              { key: "transit", label: t.inTransit, value: s.position.transit, share: tl.value ? (s.position.transit / tl.value) * 100 : undefined },
            ].filter((x) => x.value)} cur={cur} max={3} testId="inv-position-bars" />
            <p className="mt-1 text-xs text-mute">{t.whereNote}</p>
          </ChartCard>
        )}
        {s.products.length > 0 && (
          <ChartCard title={t.largest} wide testId="card-inv-products">
            <div className="grid gap-6 lg:grid-cols-2">
              <Treemap cur={cur} height={260} items={s.products.filter((p) => p.value > 0).map((p) => ({ key: p.code || p.product, label: p.product, value: p.value }))} />
              <BarList items={s.products.filter((p) => p.value > 0).map((p) => ({ key: p.code || p.product, label: p.product, value: p.value, share: tl.value ? (p.value / tl.value) * 100 : undefined }))} cur={cur} max={8} testId="inv-top-products" />
            </div>
          </ChartCard>
        )}
      </CardGrid>
      <div className="grid gap-x-8 lg:grid-cols-2" data-testid="inv-findings">
        <Findings title={T.d.sales.risk} kind="risk" findings={s.findings} />
        <Findings title={T.d.sales.watch} kind="watch" findings={s.findings} />
      </div>
    </>
  );
}

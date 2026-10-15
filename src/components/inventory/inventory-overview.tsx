"use client";
import { money } from "@/lib/engine";
import { inventoryMonthly } from "@/lib/engine/inventory";
import { useCompany } from "@/lib/company/context";
import { useInventory } from "@/lib/company/inventory-context";
import { PageHeader } from "@/components/shell/page-header";
import { LineChart } from "@/components/charts/line-chart";
import { BarList } from "@/components/charts/bar-list";
import { C } from "@/components/charts/util";
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
  if (!s) return <><PageHeader title={title} /><NoInventory /></>;
  const tl = s.tiles;
  const monthly = s.hasValue ? inventoryMonthly(d, s.end, 12) : [];
  return (
    <>
      <PageHeader title={title} right={<InventoryPicker s={s} />} />
      <p className="fade-up mb-6 max-w-4xl text-[17px] leading-relaxed" data-testid="inv-headline">{s.headline}</p>
      <div className="mb-8 grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4" data-testid="inv-tiles">
        <Tile label={t.value} value={tl.value === null ? "–" : money(tl.value, cur)} sub={<span className="text-mute">{tl.value === null ? t.needsValuation : s.label}</span>} testId="tile-stock-value" />
        <Tile label={t.days} value={tl.days === null ? "–" : String(tl.days)} sub={<span className="text-mute">{t.daysSub}</span>} neg={(tl.days ?? 0) > 120} testId="tile-stock-days" />
        <Tile label={t.cogs} value={tl.cogs === null ? "–" : money(tl.cogs, cur)} sub={<span className="text-mute">{t.cogsSub}</span>} testId="tile-stock-cogs" />
        <Tile label={t.slow} value={tl.slow === null || tl.dead === null ? "–" : money(tl.slow + tl.dead, cur)} sub={<span className="text-mute">{tl.dead === null ? t.needsValuation : t.slowSub(money(tl.dead, cur))}</span>} neg={(tl.slow ?? 0) + (tl.dead ?? 0) > 0} testId="tile-stock-slow" />
      </div>
      <TieBanner s={s} link={`${c.basePath}/inventory/valuation`} />
      <div className="grid gap-10 lg:grid-cols-2">
        <div className="min-w-0" data-testid="inv-findings">
          <Findings title={T.d.sales.risk} kind="risk" findings={s.findings} />
          <Findings title={T.d.sales.watch} kind="watch" findings={s.findings} />
          {s.bridge && <>
            <h3 className="mb-2 mt-2 text-lg font-normal">{t.howMoved}</h3>
            <StockBridge b={s.bridge} cur={cur} />
          </>}
        </div>
        <div className="min-w-0">
          {monthly.length > 0 && <>
            <h3 className="mb-1 text-lg font-normal">{t.valueVsCogs}</h3>
            <LineChart labels={monthly.map((x) => T.ms(x.p))} cur={cur} height={260} testId="inv-trend"
              series={[
                { name: t.value, values: monthly.map((x) => x.closing), color: C.s[0], fill: true },
                { name: t.cogs, values: monthly.map((x) => x.cogs), color: C.s[1], dots: false },
              ]} />
          </>}
          {s.products.length > 0 && <>
            <h3 className="mb-2 mt-8 text-lg font-normal">{t.largest}</h3>
            <BarList items={s.products.filter((p) => p.value > 0).map((p) => ({ key: p.code || p.product, label: p.product, value: p.value, share: tl.value ? (p.value / tl.value) * 100 : undefined }))} cur={cur} max={8} testId="inv-top-products" />
          </>}
        </div>
      </div>
    </>
  );
}

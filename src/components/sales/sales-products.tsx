"use client";
import { useState } from "react";
import { money, pct } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { PageHeader } from "@/components/shell/page-header";
import { BarList } from "@/components/charts/bar-list";
import { cn } from "@/lib/cn";
import { CardGrid, ChartCard } from "@/components/viz/chart-card";
import { ParetoList } from "@/components/viz/pareto";
import { Treemap } from "@/components/viz/treemap";
import { Bridge } from "@/components/viz/bridge";
import { DataNotes, FromAccountsNote, NoSales, SalesTable, SalesTile, useSalesAnalysis, SalesPicker } from "./common";
import { useT } from "@/lib/i18n/use-t";

export function SalesProducts() {
  const c = useCompany();
  const s = useSalesAnalysis();
  const [category, setCategory] = useState<string | null>(null);
  const T = useT();
  const t = T.d.sales;
  const title = T.d.nav["sales/products"][1];
  const cur = c.settings.currency;
  const cmpCol = s?.compareLabel ? t.vs(t.word[s.compareLabel] ?? s.compareLabel) : "";
  if (!s) return <><PageHeader title={title} /><NoSales /></>;
  if (s.fromAccounts) return <><PageHeader title={title} right={<SalesPicker s={s} />} /><FromAccountsNote page="products" /><SalesTable rows={s.byProduct} cur={cur} nameLabel={t.revenueAccount} compareLabel={cmpCol} testId="product-table" /></>;
  const products = category ? s.byProduct.filter((r) => r.group === category) : s.byProduct;
  return (
    <>
      <PageHeader title={title} right={<SalesPicker s={s} />} />
      <div className="mb-8 grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
        <SalesTile label={t.categoriesSold} value={s.byCategory.filter((r) => r.amount > 0).length} sub={<span className="text-mute">{t.products(s.byProduct.filter((r) => r.amount > 0).length)}</span>} />
        {(["A", "B", "C"] as const).map((k) => (
          <SalesTile key={k} label={t.classProducts(k)} value={s.abc[k].count} testId={`abc-${k}`}
            sub={<span className="text-mute">{t.abcSub(pct(s.abc[k].share, 0), k)}</span>} />
        ))}
      </div>
      <CardGrid>
        <ChartCard title={t.categories} sub={t.clickCategory} testId="card-categories">
          <BarList items={s.byCategory.map((r) => ({ key: r.key, label: T.tl(r.name), value: r.amount, share: r.share }))} cur={cur} max={12} onSelect={(k) => setCategory(k === category ? null : k)} testId="category-bars" />
        </ChartCard>
        <ChartCard title={T.d.viz.mod.productPareto} sub={T.d.viz.mod.customerParetoSub} testId="card-product-pareto">
          <ParetoList cur={cur} max={10} testId="product-pareto" items={products.map((r) => ({ key: r.key, label: r.name, value: r.amount }))} />
        </ChartCard>
        <PriceVolumeMix s={s} cur={cur} />
        <ChartCard title={T.d.viz.mod.mix} sub={T.d.viz.mod.mixSub} testId="card-product-mix">
          <Treemap cur={cur} height={260} items={products.map((r) => ({ key: r.key, label: T.tl(r.name), value: r.amount }))} />
        </ChartCard>
      </CardGrid>
      <h2 className="mb-3 mt-10 text-lg font-semibold">{t.categoriesDetail}</h2>
      <SalesTable rows={s.byCategory} cur={cur} nameLabel={t.category} compareLabel={cmpCol} testId="category-table" />
      <div className="mb-3 mt-10 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{t.productsH}</h2>
        {category && <button onClick={() => setCategory(null)} className="rounded-full bg-brand-bg px-3 py-0.5 text-xs text-brand-d" data-testid="category-filter">{category} ✕</button>}
      </div>
      <SalesTable rows={products} cur={cur} nameLabel={t.product} group={t.category} compareLabel={cmpCol} abc max={50} testId="product-table" />
      <DataNotes notes={s.notes} />
    </>
  );
}

function PriceVolumeMix({ s, cur }: { s: NonNullable<ReturnType<typeof useSalesAnalysis>>; cur: string }) {
  const p = s.pvm;
  const T = useT();
  const t = T.d.sales;
  if (!p) {
    return (
      <ChartCard title={t.whatChanged} testId="card-pvm">
        <p className="rounded bg-band px-4 py-3 text-[13px] text-mute" data-testid="pvm-missing">{s.compareLabel ? t.pvmMissing : t.noEarlier}</p>
      </ChartCard>
    );
  }
  const vals = [p.price, p.volume, p.mix, p.newLost];
  const rows: [string, number, string][] = t.pvmRows.map(([k, why], i) => [k, vals[i], why]);
  return (
    <ChartCard title={t.whatChangedVs(t.word[s.compareLabel] ?? s.compareLabel)} testId="card-pvm">
      {s.compare !== null && <Bridge cur={cur} height={240} testId="pvm-bridge" rows={[
        { label: T.d.viz.start, value: s.compare, total: true },
        ...rows.map(([k, v]) => ({ label: k, value: v })),
        { label: T.d.viz.end, value: s.total, total: true },
      ]} />}
      <table className="tbl mt-3 text-[12.5px]" data-testid="pvm-table">
        <tbody>
          {rows.map(([k, v, why]) => (
            <tr key={k} className="row"><td className="text-start"><div>{k}</div><div className="text-[11.5px] text-mute">{why}</div></td><td className={cn("num", v < 0 ? "text-red" : "text-green-d")}>{v >= 0 ? "+" : ""}{money(v, cur)}</td></tr>
          ))}
          <tr className="tot"><td className="text-start">{t.totalChange}</td><td className="num">{p.total >= 0 ? "+" : ""}{money(p.total, cur)}</td></tr>
        </tbody>
      </table>
      <p className="mt-2 text-xs text-mute">{t.qtyKnown(pct(p.coverage, 0))}</p>
    </ChartCard>
  );
}

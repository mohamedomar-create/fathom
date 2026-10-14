"use client";
import { useState } from "react";
import { money, pct } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { PageHeader } from "@/components/shell/page-header";
import { BarList } from "@/components/charts/bar-list";
import { cn } from "@/lib/cn";
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
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <h2 className="mb-2 text-xl font-light">{t.categories}</h2>
          <p className="mb-3 text-xs text-mute">{t.clickCategory}</p>
          <BarList items={s.byCategory.map((r) => ({ key: r.key, label: T.tl(r.name), value: r.amount, share: r.share }))} cur={cur} max={12} onSelect={(k) => setCategory(k === category ? null : k)} testId="category-bars" />
        </div>
        <PriceVolumeMix s={s} cur={cur} />
      </div>
      <h2 className="mb-3 mt-10 text-xl font-light">{t.categoriesDetail}</h2>
      <SalesTable rows={s.byCategory} cur={cur} nameLabel={t.category} compareLabel={cmpCol} testId="category-table" />
      <div className="mb-3 mt-10 flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-light">{t.productsH}</h2>
        {category && <button onClick={() => setCategory(null)} className="rounded-full bg-brand-bg px-3 py-0.5 text-xs text-brand-d" data-testid="category-filter">{category} ✕</button>}
      </div>
      <SalesTable rows={products} cur={cur} nameLabel={t.product} group={t.category} compareLabel={cmpCol} abc max={50} testId="product-table" />
      <DataNotes notes={s.notes} />
    </>
  );
}

function PriceVolumeMix({ s, cur }: { s: NonNullable<ReturnType<typeof useSalesAnalysis>>; cur: string }) {
  const p = s.pvm;
  const t = useT().d.sales;
  if (!p) {
    return (
      <div>
        <h2 className="mb-2 text-xl font-light">{t.whatChanged}</h2>
        <p className="rounded bg-band px-4 py-3 text-[13px] text-mute" data-testid="pvm-missing">{s.compareLabel ? t.pvmMissing : t.noEarlier}</p>
      </div>
    );
  }
  const vals = [p.price, p.volume, p.mix, p.newLost];
  const rows: [string, number, string][] = t.pvmRows.map(([k, why], i) => [k, vals[i], why]);
  return (
    <div>
      <h2 className="mb-2 text-xl font-light">{t.whatChangedVs(t.word[s.compareLabel] ?? s.compareLabel)}</h2>
      <table className="tbl" data-testid="pvm-table">
        <tbody>
          {rows.map(([k, v, why]) => (
            <tr key={k} className="row"><td className="text-start"><div>{k}</div><div className="text-[11.5px] text-mute">{why}</div></td><td className={cn("num", v < 0 ? "text-red" : "text-green-d")}>{v >= 0 ? "+" : ""}{money(v, cur)}</td></tr>
          ))}
          <tr className="tot"><td className="text-start">{t.totalChange}</td><td className="num">{p.total >= 0 ? "+" : ""}{money(p.total, cur)}</td></tr>
        </tbody>
      </table>
      <p className="mt-2 text-xs text-mute">{t.qtyKnown(pct(p.coverage, 0))}</p>
    </div>
  );
}

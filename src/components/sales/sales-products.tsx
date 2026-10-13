"use client";
import { useState } from "react";
import { money, pct } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { PageHeader } from "@/components/shell/page-header";
import { PeriodPicker } from "@/components/shell/period-picker";
import { BarList } from "@/components/charts/bar-list";
import { cn } from "@/lib/cn";
import { DataNotes, NoSales, SalesTable, SalesTile, useSalesAnalysis } from "./common";

export function SalesProducts() {
  const c = useCompany();
  const s = useSalesAnalysis();
  const [category, setCategory] = useState<string | null>(null);
  const cur = c.settings.currency;
  if (!s) return <><PageHeader title="Products and Categories" /><NoSales /></>;
  const products = category ? s.byProduct.filter((r) => r.group === category) : s.byProduct;
  const cmpCol = s.compareLabel ? `vs ${s.compareLabel}` : "";
  return (
    <>
      <PageHeader title="Products and Categories" right={<PeriodPicker />} />
      <div className="mb-8 grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
        <SalesTile label="Categories sold" value={s.byCategory.filter((r) => r.amount > 0).length} sub={<span className="text-mute">{s.byProduct.filter((r) => r.amount > 0).length} products</span>} />
        {(["A", "B", "C"] as const).map((k) => (
          <SalesTile key={k} label={`Class ${k} products`} value={s.abc[k].count} testId={`abc-${k}`}
            sub={<span className="text-mute">{pct(s.abc[k].share, 0)} of sales · {k === "A" ? "the first 80%" : k === "B" ? "the next 15%" : "the last 5%"}</span>} />
        ))}
      </div>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <h2 className="mb-2 text-xl font-light">Categories</h2>
          <p className="mb-3 text-xs text-mute">Click a category to list its products.</p>
          <BarList items={s.byCategory.map((r) => ({ key: r.key, label: r.name, value: r.amount, share: r.share }))} cur={cur} max={12} onSelect={(k) => setCategory(k === category ? null : k)} testId="category-bars" />
        </div>
        <PriceVolumeMix s={s} cur={cur} />
      </div>
      <h2 className="mb-3 mt-10 text-xl font-light">Categories in detail</h2>
      <SalesTable rows={s.byCategory} cur={cur} nameLabel="Category" compareLabel={cmpCol} testId="category-table" />
      <div className="mb-3 mt-10 flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-light">Products</h2>
        {category && <button onClick={() => setCategory(null)} className="rounded-full bg-brand-bg px-3 py-0.5 text-xs text-brand-d" data-testid="category-filter">{category} ✕</button>}
      </div>
      <SalesTable rows={products} cur={cur} nameLabel="Product" group="Category" compareLabel={cmpCol} abc max={50} testId="product-table" />
      <DataNotes notes={s.notes} />
    </>
  );
}

function PriceVolumeMix({ s, cur }: { s: NonNullable<ReturnType<typeof useSalesAnalysis>>; cur: string }) {
  const p = s.pvm;
  if (!p) {
    return (
      <div>
        <h2 className="mb-2 text-xl font-light">What changed sales</h2>
        <p className="rounded bg-band px-4 py-3 text-[13px] text-mute" data-testid="pvm-missing">{s.compareLabel ? "Splitting the change into price, volume and mix needs quantities for the same products in both periods. Upload Odoo's Sales or Invoice Analysis with the Quantity column." : "There is no earlier period loaded to compare with."}</p>
      </div>
    );
  }
  const rows: [string, number, string][] = [
    ["Price", p.price, "Same products sold at higher or lower prices"],
    ["Volume", p.volume, "More or fewer units in all, at last period's average price"],
    ["Mix", p.mix, "A shift towards dearer or cheaper products"],
    ["New and dropped products", p.newLost, "Products sold in only one of the two periods"],
  ];
  return (
    <div>
      <h2 className="mb-2 text-xl font-light">What changed sales, vs {s.compareLabel}</h2>
      <table className="tbl" data-testid="pvm-table">
        <tbody>
          {rows.map(([k, v, why]) => (
            <tr key={k} className="row"><td className="text-left"><div>{k}</div><div className="text-[11.5px] text-mute">{why}</div></td><td className={cn("num", v < 0 ? "text-red" : "text-green-d")}>{v >= 0 ? "+" : ""}{money(v, cur)}</td></tr>
          ))}
          <tr className="tot"><td className="text-left">Total change</td><td className="num">{p.total >= 0 ? "+" : ""}{money(p.total, cur)}</td></tr>
        </tbody>
      </table>
      <p className="mt-2 text-xs text-mute">Quantities are known for {pct(p.coverage, 0)} of this period&apos;s sales.</p>
    </div>
  );
}

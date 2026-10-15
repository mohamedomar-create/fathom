"use client";
import { useState } from "react";
import { money } from "@/lib/engine";
import type { ProductStat } from "@/lib/engine/inventory";
import { useCompany } from "@/lib/company/context";
import { PageHeader } from "@/components/shell/page-header";
import { useT } from "@/lib/i18n/use-t";
import { cn } from "@/lib/cn";
import { InventoryPicker, NoInventory, useInventoryAnalysis } from "./common";

type Filter = "all" | "A" | "B" | "C" | "slow" | "dead";
const keep = (f: Filter) => (p: ProductStat) => f === "all" || p.abc === f || p.flag === f;

export function InventoryProducts() {
  const c = useCompany();
  const s = useInventoryAnalysis();
  const T = useT();
  const t = T.d.inv;
  const [filter, setFilter] = useState<Filter>("all");
  const title = T.d.nav["inventory/products"][1];
  const cur = c.settings.currency;
  if (!s) return <><PageHeader title={title} /><NoInventory /></>;
  if (!s.hasValue) return <><PageHeader title={title} right={<InventoryPicker s={s} />} /><p className="text-mute" data-testid="inv-products-empty">{t.noValuation}</p></>;
  const rows = s.products.filter(keep(filter));
  const day = (d: string | null) => (d ? d.split("-").reverse().join("/") : "–");
  const filters: [Filter, string][] = [["all", t.all], ["A", t.aItems], ["B", t.bItems], ["C", t.cItems], ["slow", t.slowF], ["dead", t.deadF]];
  return (
    <>
      <PageHeader title={title} right={<InventoryPicker s={s} />} />
      <div className="mb-4 flex flex-wrap gap-2" role="group" data-testid="inv-product-filters">
        {filters.map(([f, label]) => (
          <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} data-testid={`inv-filter-${f}`}
            className={cn("rounded-full border px-3 py-1 text-[13px]", filter === f ? "border-brand-d bg-brand-bg text-brand-d" : "border-line text-[#555] hover:border-brand/60")}>
            {label} <span className="text-mute">{s.products.filter(keep(f)).length}</span>
          </button>
        ))}
      </div>
      <div className="-mx-4 overflow-x-auto sm:mx-0">
        <table className="tbl min-w-[860px]" data-testid="inv-products">
          <thead>
            <tr>
              <th className="!text-start">{t.product}</th><th className="!text-start">{t.category}</th><th className="!text-start">{t.abc}</th>
              <th>{t.qty}</th><th>{t.valueCol}</th><th>{t.cogsCol}</th><th>{t.daysCol}</th><th>{t.turnover}</th><th>{t.lastOut}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.code || p.product} className="row" data-testid="inv-product-row">
                <td className="max-w-[280px] truncate !text-start" title={p.product}>
                  {p.code && <span className="me-1.5 text-mute">[{p.code}]</span>}{p.product}
                  {p.flag && <span className={cn("ms-2 rounded px-1.5 text-[10.5px] font-semibold", p.flag === "dead" ? "bg-red-bg text-red" : "bg-amber/15 text-[#9a6b00]")}>{p.flag === "dead" ? t.flagDead : t.flagSlow}</span>}
                </td>
                <td className="max-w-[180px] truncate !text-start text-mute" title={p.category}>{p.category || "–"}</td>
                <td className="!text-start"><span data-testid={`abc-${p.abc}`} className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold", p.abc === "A" ? "bg-brand-bg text-brand-d" : "bg-band text-mute")}>{p.abc}</span></td>
                <td className="num">{p.qty.toLocaleString("en-US")}</td>
                <td className="num">{money(p.value, cur)}</td>
                <td className="num text-mute">{p.cogs ? money(p.cogs, cur) : "–"}</td>
                <td className="num">{p.days ?? "–"}</td>
                <td className="num">{p.turnover ?? "–"}</td>
                <td className="num text-mute">{day(p.lastOut)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="mt-3 text-mute">{t.noneMatch}</p>}
      </div>
      <p className="mt-4 max-w-3xl text-xs text-mute">{t.abcNote}</p>
    </>
  );
}

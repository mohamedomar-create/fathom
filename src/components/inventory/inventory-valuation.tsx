"use client";
import { money } from "@/lib/engine";
import { monthBridge, receiptCost } from "@/lib/engine/inventory";
import { productKey } from "@/lib/ingest/inventory";
import { windowFor } from "@/lib/engine/period";
import { addMonths } from "@/lib/engine/format";
import { useCompany } from "@/lib/company/context";
import { useInventory } from "@/lib/company/inventory-context";
import { usePeriod } from "@/lib/company/use-period";
import { PageHeader } from "@/components/shell/page-header";
import { Sparkline } from "@/components/charts/spark";
import { Delta } from "@/components/ui/status";
import { useT } from "@/lib/i18n/use-t";
import { cn } from "@/lib/cn";
import { InventoryPicker, NoInventory, TieBanner, TieTable, useInventoryAnalysis } from "./common";

export function InventoryValuation() {
  const c = useCompany();
  const d = useInventory();
  const s = useInventoryAnalysis();
  const { sel } = usePeriod();
  const T = useT();
  const t = T.d.inv;
  const title = T.d.nav["inventory/valuation"][1];
  const cur = c.settings.currency;
  if (!s) return <><PageHeader title={title} /><NoInventory /></>;
  const periods = windowFor({ type: sel.type, end: s.end }, c.settings.fyStartMonth).periods;
  const rows = s.hasValue ? periods.map((p) => ({ p, ...monthBridge(d, p) })) : [];
  const cols: [keyof (typeof rows)[number], string][] = [["opening", t.opening], ["receipts", t.receipts], ["landed", t.landed], ["deliveries", t.deliveries], ["returns", t.returns], ["adjustments", t.adjustments], ["revaluation", t.revaluation], ["closing", t.closing]];
  const shown = cols.filter(([k]) => k === "opening" || k === "closing" || rows.some((r) => r[k]));
  // Unit cost when received, for the three products with the most cost of sales, over the last twelve months.
  const last12 = Array.from({ length: 12 }, (_, i) => addMonths(s.end, i - 11));
  const top = [...s.products].sort((a, b) => b.cogs - a.cogs).slice(0, 3).map((p) => productKey(p.code, p.product));
  const prices = s.hasValue ? receiptCost(d, top, last12).filter((x) => x.points.filter((v) => v !== null).length > 1) : [];
  return (
    <>
      <PageHeader title={title} right={<InventoryPicker s={s} />} />
      <TieBanner s={s} />
      <h3 className="mb-2 text-lg font-normal">{t.tieTitle}</h3>
      <TieTable tieouts={s.tieouts} cur={cur} />
      <h3 className="mb-2 mt-10 text-lg font-normal">{t.layersTitle}</h3>
      {s.hasValue ? (
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="tbl min-w-[760px]" data-testid="inv-layers">
            <thead><tr><th className="!text-start">{t.month}</th>{shown.map(([k, label]) => <th key={k}>{label}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.p} className="row">
                  <td className="!text-start">{T.ml(r.p)}</td>
                  {shown.map(([k]) => {
                    const v = r[k] as number;
                    return <td key={k} className={cn("num", (k === "opening" || k === "closing") && "font-medium", k !== "opening" && k !== "closing" && v < 0 && "text-red")}>{v ? money(v, cur) : "–"}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-mute">{t.layersNote}</p>
        </div>
      ) : <p className="text-mute" data-testid="inv-layers-empty">{t.noValuation}</p>}
      {prices.length > 0 && <>
        <h3 className="mb-2 mt-10 text-lg font-normal">{t.priceTitle}</h3>
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="tbl min-w-[560px]" data-testid="inv-unit-cost">
            <thead><tr><th className="!text-start">{t.product}</th><th>{t.firstCost}</th><th>{t.lastCost}</th><th>{t.change}</th><th className="!text-start">{t.twelveMonths}</th></tr></thead>
            <tbody>
              {prices.map((x) => {
                const pts = x.points.filter((v): v is number => v !== null);
                const a = pts[0], z = pts[pts.length - 1];
                return (
                  <tr key={x.code} className="row">
                    <td>{x.product}</td>
                    <td className="num">{money(a, cur)}</td>
                    <td className="num">{money(z, cur)}</td>
                    <td><Delta value={a ? ((z - a) / a) * 100 : null} good={z <= a} /></td>
                    <td className="!text-start"><Sparkline values={pts} w={110} h={22} color="#7a7a72" />{x.odd.length > 0 && <div className="mt-1 text-[11px] text-[#9a6b00]" data-testid="check-receipt">{t.checkReceipt(x.odd.map((p) => T.ms(p)).join(", "))}</div>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>}
    </>
  );
}

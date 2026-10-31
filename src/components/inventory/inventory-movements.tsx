"use client";
import { MOVE_KINDS } from "@/lib/engine/inventory";
import { PageHeader } from "@/components/shell/page-header";
import { useT } from "@/lib/i18n/use-t";
import { InventoryPicker, NoInventory, useInventoryAnalysis } from "./common";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCompany } from "@/lib/company/context";
import { LOCATION_TYPES, type LocationType } from "@/lib/ingest/inventory";
import { saveInventorySettings } from "@/app/company/[id]/settings/actions";

const q = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });

export function InventoryMovements() {
  const s = useInventoryAnalysis();
  const c = useCompany();
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);
  const T = useT();
  const t = T.d.inv;
  const title = T.d.nav["inventory/movements"][1];
  if (!s) return <><PageHeader title={title} /><NoInventory /></>;
  if (!s.hasMoves) return <><PageHeader title={title} right={<InventoryPicker s={s} />} /><p className="text-mute" data-testid="inv-movements-empty">{t.noMoves}</p></>;
  const periods = [...new Set(s.movements.map((m) => m.p))].sort();
  const kinds = MOVE_KINDS.filter((k) => s.movements.some((m) => m.kind === k));
  const at = (p: string, k: string) => s.movements.find((m) => m.p === p && m.kind === k)?.q ?? 0;
  const rental = kinds.includes("rental_out") || kinds.includes("rental_back");
  const locations = [...s.locations].sort((a, b) => b.inQ + b.outQ - (a.inQ + a.outQ));
  return (
    <>
      <PageHeader title={title} right={<InventoryPicker s={s} />} />
      <h3 className="mb-2 text-lg font-normal">{t.movesTitle}</h3>
      <div className="-mx-4 overflow-x-auto sm:mx-0">
        <table className="tbl min-w-[560px]" data-testid="inv-movements">
          <thead><tr><th className="!text-start">{t.movement}</th>{periods.map((p) => <th key={p}>{T.ms(p)}</th>)}{periods.length > 1 && <th>{t.total}</th>}</tr></thead>
          <tbody>
            {kinds.map((k) => (
              <tr key={k} className="row">
                <td className="!text-start">{t.kinds[k] ?? k}</td>
                {periods.map((p) => <td key={p} className="num">{at(p, k) ? q(at(p, k)) : "–"}</td>)}
                {periods.length > 1 && <td className="num font-medium">{q(periods.reduce((x, p) => x + at(p, k), 0))}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rental && <p className="mt-2 text-xs text-mute">{t.rentalNote}</p>}
      <StockAtEnd s={s} ar={T.lang === "ar"} ml={T.ml} />
      <StockHistoryTable s={s} ar={T.lang === "ar"} ms={T.ms} />
      <h3 className="mb-2 mt-10 text-lg font-normal">{t.locationsTitle}</h3>
      <div className="-mx-4 overflow-x-auto sm:mx-0">
        <table className="tbl min-w-[480px]" data-testid="inv-locations">
          <thead><tr><th className="!text-start">{t.location}</th><th className="!text-start">{t.countsAs}</th><th>{t.inQ}</th><th>{t.outQ}</th><th>{t.net}</th></tr></thead>
          <tbody>
            {locations.map((l) => (
              <tr key={l.loc} className="row">
                <td className="!text-start">{l.loc}</td>
                <td className="!text-start">
                  {c.readOnly ? t.countsKinds[l.counts] : (
                    <select value={l.counts} disabled={saving === l.loc} aria-label={`${t.countsAs}: ${l.loc}`} className="rounded border border-line px-1.5 py-0.5 text-[13px]"
                      onChange={async (e) => { setSaving(l.loc); await setType(l.loc, e.target.value as LocationType); setSaving(null); }}>
                      {LOCATION_TYPES.map((k) => <option key={k} value={k}>{t.countsKinds[k]}</option>)}
                    </select>
                  )}
                </td>
                <td className="num">{q(l.inQ)}</td>
                <td className="num">{q(l.outQ)}</td>
                <td className="num font-medium">{q(l.inQ - l.outQ)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-mute">{t.countsNote}</p>
    </>
  );
  async function setType(loc: string, type: LocationType) {
    const r = await saveInventorySettings(c.id, { rentalLocation: c.inventorySettings?.rentalLocation ?? null, locationTypes: { [loc]: type } });
    if (r.ok) router.refresh();
  }
}

type View = NonNullable<ReturnType<typeof useInventoryAnalysis>>;
const TYPE_WORD: Record<LocationType, [string, string]> = { internal: ["Warehouse", "مخزن"], transit: ["In transit", "في الطريق"], rental: ["Out on rental", "مؤجر"], outside: ["Outside stock", "خارج المخزون"] };

/** Units in each stock location at the end of the period chosen (from the moves to that month). */
function StockAtEnd({ s, ar, ml }: { s: View; ar: boolean; ml: (p: string) => string }) {
  if (!s.atEnd.length) return null;
  const end = s.history[s.history.length - 1]?.p;
  return (
    <section className="mt-10" data-testid="inv-at-end">
      <h3 className="mb-2 text-lg font-normal">{ar ? "الوحدات حسب الموقع" : "Units by location"} {end && <span className="text-sm text-mute">· {ar ? "نهاية" : "end of"} {ml(end)}</span>}</h3>
      <div className="-mx-4 overflow-x-auto sm:mx-0">
        <table className="tbl min-w-[420px]">
          <thead><tr><th className="!text-start">{ar ? "الموقع" : "Location"}</th><th className="!text-start">{ar ? "النوع" : "Type"}</th><th>{ar ? "الوحدات" : "Units"}</th></tr></thead>
          <tbody>{s.atEnd.map((x) => <tr key={x.loc} className="row" data-testid="inv-at-end-row"><td className="!text-start">{x.loc}</td><td className="!text-start">{TYPE_WORD[x.type][ar ? 1 : 0]}</td><td className="num">{q(x.units)}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="mt-1 text-xs text-mute">{ar ? "من الحركات حتى نهاية الشهر المختار." : "From the moves up to the end of the month chosen."}</p>
    </section>
  );
}

/** Units and value at each month end over the 12 months to the period's end, with the largest categories. */
function StockHistoryTable({ s, ar, ms }: { s: View; ar: boolean; ms: (p: string) => string }) {
  if (!s.history.length) return null;
  const last = s.history[s.history.length - 1];
  const cats = Object.entries(last.byCategory).sort((a, b) => b[1].value - a[1].value).slice(0, 6).map(([k]) => k);
  return (
    <section className="mt-10" data-testid="inv-history">
      <h3 className="mb-2 text-lg font-normal">{ar ? "تاريخ المخزون: وحدات وقيمة في نهاية كل شهر" : "Stock history: units and value at each month end"}</h3>
      <div className="-mx-4 overflow-x-auto sm:mx-0">
        <table className="tbl min-w-[720px]">
          <thead><tr><th className="!text-start" />{s.history.map((h) => <th key={h.p}>{ms(h.p)}</th>)}</tr></thead>
          <tbody>
            <tr className="row font-medium"><td className="!text-start">{ar ? "الوحدات" : "Units"}</td>{s.history.map((h) => <td key={h.p} className="num">{q(h.units)}</td>)}</tr>
            <tr className="row font-medium"><td className="!text-start">{ar ? "القيمة" : "Value"}</td>{s.history.map((h) => <td key={h.p} className="num">{Math.round(h.value).toLocaleString("en-US")}</td>)}</tr>
            {cats.map((c) => <tr key={c} className="row"><td className="!text-start">{c} · {ar ? "وحدات" : "units"}</td>{s.history.map((h) => <td key={h.p} className="num">{h.byCategory[c] ? q(h.byCategory[c].units) : "–"}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-xs text-mute">{ar ? "الوحدات والقيمة من التقييم؛ الوحدات حسب الموقع من الحركات." : "Units and value from the valuation; units by location from the moves."}</p>
    </section>
  );
}

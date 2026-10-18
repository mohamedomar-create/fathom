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

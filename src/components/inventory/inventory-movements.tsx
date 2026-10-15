"use client";
import { MOVE_KINDS } from "@/lib/engine/inventory";
import { PageHeader } from "@/components/shell/page-header";
import { useT } from "@/lib/i18n/use-t";
import { InventoryPicker, NoInventory, useInventoryAnalysis } from "./common";

const q = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });

export function InventoryMovements() {
  const s = useInventoryAnalysis();
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
          <thead><tr><th className="!text-start">{t.location}</th><th>{t.inQ}</th><th>{t.outQ}</th><th>{t.net}</th></tr></thead>
          <tbody>
            {locations.map((l) => (
              <tr key={l.loc} className="row">
                <td className="!text-start">{l.loc}</td>
                <td className="num">{q(l.inQ)}</td>
                <td className="num">{q(l.outQ)}</td>
                <td className="num font-medium">{q(l.inQ - l.outQ)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

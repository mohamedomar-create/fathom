"use client";
import { useMemo, useState, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { money } from "@/lib/engine";
import type { InventoryParts } from "@/lib/ingest/inventory-sheets";
import { saveInventory } from "@/lib/company/save-inventory";
import { saveInventorySettings } from "@/app/company/[id]/settings/actions";
import { WizardNav, WizardSteps, WizardTitle } from "@/components/upload/wizard-shell";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/use-t";

/** Check and save screens for Inventory sheets: what was read, the rental location, replace or add only new, then save. */
export function InventoryStep({ parts, companyId, currency, demo, filename, rentalLocation, onRental, rolesPanel, fileLine, rolesBlock, onBack, onDone }: {
  parts: InventoryParts; companyId: string; currency: string; demo: boolean; filename: string;
  rentalLocation: string | null; onRental: (loc: string | null) => void;
  rolesPanel: React.ReactNode; fileLine: React.ReactNode; rolesBlock: boolean;
  onBack: () => void; onDone: (what: string) => void;
}) {
  const T = useT(), w = T.d.wiz.inv, ww = T.d.wiz.w;
  const [screen, setScreen] = useState<"check" | "save">("check");
  const [mode, setMode] = useState<"replace" | "add" | "all" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const months = useMemo(() => [...new Set([...parts.layers, ...parts.moves].map((x) => x.period))].sort(), [parts]);
  const value = parts.layers.reduce((s, l) => s + l.value, 0);
  const rentalMoves = parts.moves.filter((m) => m.kind === "rental_out" || m.kind === "rental_back").length;
  const count = parts.layers.length + parts.moves.length + (parts.onhand?.rows.length ?? 0) + parts.products.length;
  const span = months.length ? (months.length === 1 ? months[0] : w.span(months[0], months[months.length - 1])) : "";

  if (screen === "save") {
    return (
      <div data-testid="inventory-save">
        <WizardSteps at="save" />
        <WizardTitle title={w.save} hint={w.saveHint(count.toLocaleString("en-US"), span)} />
        <div className="grid max-w-4xl gap-3 md:grid-cols-3" data-testid="inventory-mode">
          {([["all", w.all, w.allSub],
            ["replace", w.replace, w.replaceSub(span)],
            ["add", w.add, w.addSub]] as const).map(([m, t, sub]) => (
            <button key={m} onClick={() => setMode(m)} data-testid={`inventory-mode-${m}`}
              className={cn("rounded-xl border-2 p-4 text-start", mode === m ? "border-brand-d bg-brand-bg" : "border-line hover:border-brand/60")}>
              <div className="text-[16px] font-medium">{t}</div><div className="mt-1 text-[13px] text-mute">{sub}</div>
            </button>
          ))}
        </div>
        {!parts.withIds && <p className="mt-4 flex max-w-4xl gap-2 rounded bg-amber/10 px-3 py-2 text-[13px]"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber" />{w.noIds}</p>}
        {err && <p className="mt-4 rounded bg-red-bg px-3 py-2 text-sm text-red" role="alert">{err}</p>}
        <WizardNav onBack={() => setScreen("check")} next={saving ? ww.saving : w.saveStock} nextTestId="save-inventory" disabled={saving || !mode || !count} hint={!mode ? ww.chooseFirst : undefined}
          onNext={() => start(async () => {
            setErr(null);
            const r = await saveInventory(companyId, { layers: parts.layers, moves: parts.moves, onhand: parts.onhand ?? undefined, products: parts.products }, filename, mode!);
            if (!r.ok) { setErr(r.error); return; }
            if (parts.moves.length) await saveInventorySettings(companyId, { rentalLocation });
            onDone(w.added(r.added.toLocaleString("en-US"), r.already.toLocaleString("en-US")));
          })} />
      </div>
    );
  }
  return (
    <div data-testid="inventory-only">
      <WizardSteps at="check" />
      <WizardTitle title={w.check} hint={rolesBlock ? ww.checkRoles : ww.allGood} />
      {fileLine}
      {rolesPanel}
      <div className="mb-4 grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-4" data-testid="inventory-preview">
        <Stat label={ww.months} value={String(months.length)} sub={span} />
        <Stat label={w.layers} value={parts.layers.length.toLocaleString("en-US")} sub={parts.layers.length ? w.net(money(value, currency)) : w.noneHere} />
        <Stat label={w.moves} value={parts.moves.length.toLocaleString("en-US")} sub={rentalMoves ? w.rental(rentalMoves) : ""} />
        <Stat label={w.onhand} value={(parts.onhand?.rows.length ?? 0).toLocaleString("en-US")} sub={parts.onhand ? w.on(parts.onhand.asOf) : w.noneHere} />
      </div>
      {parts.moves.length > 0 && (
        <label className="mb-4 flex max-w-4xl flex-wrap items-center gap-2 text-[14px]" data-testid="rental-location">
          {w.rentedTo}
          <select value={rentalLocation ?? ""} onChange={(e) => onRental(e.target.value || null)} className="rounded border border-line px-2 py-1 text-[13px]" data-testid="rental-location-select">
            <option value="">{w.rentalDefault}</option>
            {parts.locations.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <span className="text-[13px] text-mute">{w.rentalNote}</span>
        </label>
      )}
      {err && <p className="mt-4 rounded bg-red-bg px-3 py-2 text-sm text-red" role="alert">{err}</p>}
      {demo
        ? <WizardNav onBack={onBack} next={ww.signup} href="/login?mode=signup" nextTestId="commit-import" />
        : <WizardNav onBack={onBack} next={ww.nextSave} onNext={() => { setMode(null); setScreen("save"); }} disabled={!count || rolesBlock} nextTestId="inventory-next"
            hint={rolesBlock ? ww.confirmFirst : !count ? ww.nothingSheets : undefined} />}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-line px-3 py-2">
      <div className="text-[12px] text-mute">{label}</div>
      <div className="num text-xl">{value}</div>
      {sub && <div className="text-[12px] text-mute">{sub}</div>}
    </div>
  );
}

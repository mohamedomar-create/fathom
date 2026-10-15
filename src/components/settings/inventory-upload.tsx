"use client";
import { useMemo, useState, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { money } from "@/lib/engine";
import type { Grid } from "@/lib/ingest/extract";
import { isInternalLocation, readProducts, readStockMoves, readStockOnHand, readStockValuation, type OnHand, type ProductRow, type StockLayer, type StockMove } from "@/lib/ingest/inventory";
import type { SheetRole } from "@/lib/ingest/roles";
import { saveInventory } from "@/lib/company/save-inventory";
import { saveInventorySettings } from "@/app/company/[id]/settings/actions";
import { WizardNav, WizardSteps, WizardTitle } from "@/components/upload/wizard-shell";
import { cn } from "@/lib/cn";

export interface InventoryParts {
  layers: StockLayer[];
  moves: StockMove[];
  onhand: { asOf: string; rows: OnHand[] } | null;
  products: ProductRow[];
  /** Every valuation and moves row carries Odoo's record ID (duplicates are then refused exactly). */
  withIds: boolean;
  /** Per sheet: what it gave, for the sheet list. */
  sheets: Record<string, string>;
  /** The company's own locations in the moves, for the rental-location choice. */
  locations: string[];
}

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** Reads every sheet the person marked as an Inventory sheet (each kind by its own reader). */
export function readInventorySheets(grids: Grid[], roleOf: (sheet: string) => SheetRole, rentalLocation: string | null, currency: string, asOf = today()): InventoryParts | null {
  const parts: InventoryParts = { layers: [], moves: [], onhand: null, products: [], withIds: true, sheets: {}, locations: [] };
  let any = false;
  const n = (k: number, w: string) => `${k.toLocaleString("en-US")} ${w}${k === 1 ? "" : "s"}`;
  for (const g of grids) {
    const role = roleOf(g.name);
    if (role === "stock_valuation") {
      const r = readStockValuation(g);
      any = true;
      if (!r) { parts.sheets[g.name] = "Could not be read as a stock valuation."; continue; }
      parts.layers.push(...r.layers); parts.withIds &&= r.withIds;
      parts.sheets[g.name] = `${n(r.layers.length, "valuation layer")}, net value ${money(r.layers.reduce((s, l) => s + l.value, 0), currency)}${r.withIds ? "" : " · no Odoo ID column"}`;
    } else if (role === "stock_moves") {
      const r = readStockMoves(g, rentalLocation);
      any = true;
      if (!r) { parts.sheets[g.name] = "Could not be read as a moves history."; continue; }
      parts.moves.push(...r.moves); parts.withIds &&= r.withIds;
      parts.sheets[g.name] = `${n(r.moves.length, "done move")}${r.withIds ? "" : " · no Odoo ID column"}`;
    } else if (role === "stock_onhand") {
      const rows = readStockOnHand(g, asOf);
      any = true;
      if (!rows) { parts.sheets[g.name] = "Could not be read as stock on hand."; continue; }
      parts.onhand = { asOf, rows: [...(parts.onhand?.rows ?? []), ...rows] };
      parts.sheets[g.name] = `${n(rows.length, "stock line")} on ${asOf}`;
    } else if (role === "products") {
      const rows = readProducts(g);
      any = true;
      if (!rows) { parts.sheets[g.name] = "Could not be read as a products list."; continue; }
      parts.products.push(...rows);
      parts.sheets[g.name] = n(rows.length, "product");
    }
  }
  if (!any) return null;
  parts.locations = [...new Set(parts.moves.flatMap((m) => [m.from, m.to]).filter(isInternalLocation))].sort();
  return parts;
}

/** Check and save screens for Inventory sheets: what was read, the rental location, replace or add only new, then save. */
export function InventoryStep({ parts, companyId, currency, demo, filename, rentalLocation, onRental, rolesPanel, fileLine, rolesBlock, onBack, onDone }: {
  parts: InventoryParts; companyId: string; currency: string; demo: boolean; filename: string;
  rentalLocation: string | null; onRental: (loc: string | null) => void;
  rolesPanel: React.ReactNode; fileLine: React.ReactNode; rolesBlock: boolean;
  onBack: () => void; onDone: (what: string) => void;
}) {
  const [screen, setScreen] = useState<"check" | "save">("check");
  const [mode, setMode] = useState<"replace" | "add" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const months = useMemo(() => [...new Set([...parts.layers, ...parts.moves].map((x) => x.period))].sort(), [parts]);
  const value = parts.layers.reduce((s, l) => s + l.value, 0);
  const rentalMoves = parts.moves.filter((m) => m.kind === "rental_out" || m.kind === "rental_back").length;
  const count = parts.layers.length + parts.moves.length + (parts.onhand?.rows.length ?? 0) + parts.products.length;
  const span = months.length ? (months.length === 1 ? months[0] : `${months[0]} to ${months[months.length - 1]}`) : "";

  if (screen === "save") {
    return (
      <div data-testid="inventory-save">
        <WizardSteps at="save" />
        <WizardTitle title="Save your stock" hint={`${count.toLocaleString("en-US")} records${span ? `, ${span}` : ""}.`} />
        <div className="grid max-w-4xl gap-3 md:grid-cols-2" data-testid="inventory-mode">
          {([["replace", "Replace these months", "Valuation and moves of these months are replaced by this file. The same file uploaded again replaces its earlier copy."],
            ["add", "Add only new records", "Records already saved (same Odoo ID) are kept and counted. Nothing is removed."]] as const).map(([m, t, sub]) => (
            <button key={m} onClick={() => setMode(m)} data-testid={`inventory-mode-${m}`}
              className={cn("rounded-xl border-2 p-4 text-start", mode === m ? "border-brand-d bg-brand-bg" : "border-line hover:border-brand/60")}>
              <div className="text-[16px] font-medium">{t}</div><div className="mt-1 text-[13px] text-mute">{sub}</div>
            </button>
          ))}
        </div>
        {!parts.withIds && <p className="mt-4 flex max-w-4xl gap-2 rounded bg-amber/10 px-3 py-2 text-[13px]"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber" />These sheets have no Odoo ID column. Records are matched by date, document, product, lot and amounts instead. For an exact check, export again with “I want to update data (import-compatible export)” ticked.</p>}
        {err && <p className="mt-4 rounded bg-red-bg px-3 py-2 text-sm text-red" role="alert">{err}</p>}
        <WizardNav onBack={() => setScreen("check")} next={saving ? "Saving…" : "Save stock"} nextTestId="save-inventory" disabled={saving || !mode || !count} hint={!mode ? "Choose one first." : undefined}
          onNext={() => start(async () => {
            setErr(null);
            const r = await saveInventory(companyId, { layers: parts.layers, moves: parts.moves, onhand: parts.onhand ?? undefined, products: parts.products }, filename, mode!);
            if (!r.ok) { setErr(r.error); return; }
            if (parts.moves.length) await saveInventorySettings(companyId, { rentalLocation });
            onDone(`${r.added.toLocaleString("en-US")} added · ${r.already.toLocaleString("en-US")} already here`);
          })} />
      </div>
    );
  }
  return (
    <div data-testid="inventory-only">
      <WizardSteps at="check" />
      <WizardTitle title="Check your stock" hint={rolesBlock ? "Check what each sheet is, then confirm." : "All good. Look, then press Next."} />
      {fileLine}
      {rolesPanel}
      <div className="mb-4 grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-4" data-testid="inventory-preview">
        <Stat label="Months" value={String(months.length)} sub={span} />
        <Stat label="Valuation layers" value={parts.layers.length.toLocaleString("en-US")} sub={parts.layers.length ? `net ${money(value, currency)}` : "none in this upload"} />
        <Stat label="Done moves" value={parts.moves.length.toLocaleString("en-US")} sub={rentalMoves ? `${rentalMoves} rental` : ""} />
        <Stat label="Stock on hand" value={(parts.onhand?.rows.length ?? 0).toLocaleString("en-US")} sub={parts.onhand ? `on ${parts.onhand.asOf}` : "none in this upload"} />
      </div>
      {parts.moves.length > 0 && (
        <label className="mb-4 flex max-w-4xl flex-wrap items-center gap-2 text-[14px]" data-testid="rental-location">
          Rented items go to:
          <select value={rentalLocation ?? ""} onChange={(e) => onRental(e.target.value || null)} className="rounded border border-line px-2 py-1 text-[13px]" data-testid="rental-location-select">
            <option value="">Found by its name (“Rental”, “تأجير”)</option>
            {parts.locations.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <span className="text-[13px] text-mute">Moves to and from it are rentals: they change where items are, not their value.</span>
        </label>
      )}
      {err && <p className="mt-4 rounded bg-red-bg px-3 py-2 text-sm text-red" role="alert">{err}</p>}
      {demo
        ? <WizardNav onBack={onBack} next="Create a free account to save" href="/login?mode=signup" nextTestId="commit-import" />
        : <WizardNav onBack={onBack} next="Next: save" onNext={() => { setMode(null); setScreen("save"); }} disabled={!count || rolesBlock} nextTestId="inventory-next"
            hint={rolesBlock ? "Confirm what each sheet is (above) first." : !count ? "Nothing to save from these sheets." : undefined} />}
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

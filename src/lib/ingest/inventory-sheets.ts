import { money } from "@/lib/engine/format";
import type { Grid } from "@/lib/ingest/extract";
import { classifyLayers, locationClass, readProducts, readStockMoves, readStockOnHand, readStockValuation, type OnHand, type ProductRow, type StockLayer, type StockMove } from "@/lib/ingest/inventory";
import type { SheetRole } from "@/lib/ingest/roles";

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
  // Each valuation row is what its move did (where the goods went), whatever its reference is called.
  if (parts.layers.length && parts.moves.length) parts.layers = classifyLayers(parts.layers, parts.moves);
  // Where rented goods can go: the company's own and Odoo's rental locations (not suppliers, customers or adjustments).
  parts.locations = [...new Set(parts.moves.flatMap((m) => [m.from, m.to]))].filter((l) => l && (locationClass(l) !== "partner" && (locationClass(l) !== "virtual" || /rental|تأجير|إيجار|ايجار/i.test(l)))).sort();
  return parts;
}


import type { LayerKind, MoveKind, OnHand, ProductRow } from "@/lib/ingest/inventory";

/**
 * The Inventory module: Odoo's valuation layers, done moves and stock on hand, added up by month, product, kind and
 * location in the database. Values are Odoo's own (company currency, incoming positive, outgoing negative).
 */
export type { LayerKind, MoveKind, OnHand, ProductRow };
export const LAYER_KINDS: readonly LayerKind[] = ["receipt", "delivery", "customer_return", "supplier_return", "landed_cost", "adjustment", "scrap", "revaluation", "other"];
export const MOVE_KINDS: readonly MoveKind[] = ["receipt", "delivery", "customer_return", "supplier_return", "internal", "rental_out", "rental_back", "adjustment", "scrap", "manufacturing"];

/** Per month, product and kind: q quantity, v value, n layers. */
export interface LayerRow { p: string; kind: LayerKind; code: string; product: string; category: string; q: number; v: number; n: number }
/** Per month, product, kind and route: q quantity, n move lines. */
export interface MoveRow { p: string; kind: MoveKind; code: string; product: string; from: string; to: string; q: number; n: number }

export interface InventoryData {
  layers: LayerRow[];
  moves: MoveRow[];
  /** Product code → the last day it went out to a customer. */
  lastOut: Record<string, string>;
  /** The latest stock-on-hand snapshot. */
  onhand: OnHand[];
  products: ProductRow[];
  /** The module's value by month and document, and the ledger's, for the records behind a tie-out difference. */
  byRef: { p: string; ref: string; kind: LayerKind; v: number }[];
  ledger: { p: string; ref: string; v: number }[];
  meta: { withIds: boolean; kinds: string[]; periods: string[] };
}

export const EMPTY_INVENTORY: InventoryData = { layers: [], moves: [], lastOut: {}, onhand: [], products: [], byRef: [], ledger: [], meta: { withIds: false, kinds: [], periods: [] } };

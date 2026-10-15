"use client";
import { inventoryPeriods, type OnHand, type ProductRow, type StockLayer, type StockLedgerLine, type StockMove } from "@/lib/ingest/inventory";
import { addInventoryRows, addStockLedgerLines, finishInventoryBatch, setOnHand, setProducts, startInventoryBatch, startStockLedgerBatch } from "@/app/company/[id]/settings/inventory-actions";

const CHUNK = 3000;
const cut = (s: string, n: number) => (s ?? "").slice(0, n);

/** A layer as the database stores it (where it was read stays in the browser). */
const layerRow = (l: StockLayer) => ({
  odoo_key: cut(l.key, 200), day: l.day, period: l.period, ref: cut(l.ref, 120), kind: l.kind, product: cut(l.product, 300), code: cut(l.code, 120),
  category: cut(l.category, 200), lot: cut(l.lot, 120), qty: l.qty, unit_value: l.unitValue, value: l.value, partner: cut(l.partner, 200), landed_ref: cut(l.landedRef, 120),
});
const moveRow = (m: StockMove) => ({
  odoo_key: cut(m.key, 200), day: m.day, period: m.period, ref: cut(m.ref, 120), kind: m.kind, product: cut(m.product, 300), code: cut(m.code, 120),
  lot: cut(m.lot, 120), from_loc: cut(m.from, 200), to_loc: cut(m.to, 200), qty: m.qty, uom: cut(m.uom, 60), partner: cut(m.partner, 200),
});

type Out = { ok: true; added: number; already: number } | { ok: false; error: string };

async function saveRows(companyId: string, kind: "valuation" | "moves", rows: Record<string, unknown>[], periods: string[], filename: string, mode: "replace" | "add"): Promise<Out> {
  const start = await startInventoryBatch({ companyId, kind, periods, filename: cut(filename, 300), mode });
  if (!start.ok) return start;
  // Chunks are staged; the upload is finished in one step, so the pages show all of it or none of it.
  let repeated = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const r = await addInventoryRows(companyId, start.batch, kind, rows.slice(i, i + CHUNK));
    if (!r.ok) return r;
    repeated += r.repeated;
  }
  const done = await finishInventoryBatch(companyId, start.batch);
  if (!done.ok) return done;
  return { ok: true, added: done.added, already: done.already + repeated };
}

/**
 * Saves what was read from Inventory sheets, each kind as its own upload: valuation layers and moves in chunks the server
 * accepts, finished in one step (records already stored under the same Odoo ID are counted, not added), the stock-on-hand
 * snapshot, the products.
 */
export async function saveInventory(companyId: string, parts: { layers?: StockLayer[]; moves?: StockMove[]; onhand?: { asOf: string; rows: OnHand[] }; products?: ProductRow[] }, filename: string, mode: "replace" | "add"): Promise<Out> {
  let added = 0, already = 0;
  for (const [kind, list, toRow] of [["valuation", parts.layers, layerRow], ["moves", parts.moves, moveRow]] as const) {
    if (!list?.length) continue;
    const r = await saveRows(companyId, kind, (list as (StockLayer & StockMove)[]).map((x) => (toRow as (y: StockLayer & StockMove) => Record<string, unknown>)(x)), inventoryPeriods(list), filename, mode);
    if (!r.ok) return r;
    added += r.added;
    already += r.already;
  }
  if (parts.onhand?.rows.length) {
    const start = await startInventoryBatch({ companyId, kind: "onhand", periods: [parts.onhand.asOf.slice(0, 7)], filename: cut(filename, 300), mode: "replace" });
    if (!start.ok) return start;
    const rows = parts.onhand.rows.map((o) => ({ product: cut(o.product, 300), code: cut(o.code, 120), location: cut(o.location, 200), lot: cut(o.lot, 120), qty: o.qty, value: o.value }));
    const r = await setOnHand(companyId, start.batch, parts.onhand.asOf, rows);
    if (!r.ok) return r;
    added += r.saved;
  }
  if (parts.products?.length) {
    const rows = parts.products.filter((p) => p.code).map((p) => ({ code: cut(p.code, 120), name: cut(p.name, 300), category: cut(p.category, 200), cost: p.cost, type: cut(p.type, 60) }));
    if (rows.length) {
      const r = await setProducts(companyId, rows);
      if (!r.ok) return r;
      added += r.saved;
    }
  }
  return { ok: true, added, already };
}

const LEDGER_CHUNK = 4000;
/** Saves the General Ledger's stock postings for the months uploaded (they replace what those months held). */
export async function saveStockLedger(companyId: string, lines: StockLedgerLine[], filename: string): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  if (!lines.length) return { ok: true, saved: 0 };
  const start = await startStockLedgerBatch(companyId, inventoryPeriods(lines), cut(filename, 300));
  if (!start.ok) return start;
  if (!start.batch) return { ok: true, saved: 0 };
  let saved = 0;
  for (let i = 0; i < lines.length; i += LEDGER_CHUNK) {
    const part = lines.slice(i, i + LEDGER_CHUNK).map((l) => ({ day: l.day || null, period: l.period, ref: cut(l.ref, 120), account: cut(l.account, 200), amount: l.amount }));
    const r = await addStockLedgerLines(companyId, start.batch, part);
    if (!r.ok) return r;
    saved += r.saved;
  }
  return { ok: true, saved };
}

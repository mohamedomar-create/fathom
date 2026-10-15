import sample from "../../../reference/sample.json";
import type { MonthData } from "@/lib/engine";
import type { InventoryData, LayerRow, MoveRow } from "@/lib/engine/inventory";
import { productKey, type OnHand } from "@/lib/ingest/inventory";
import { spreadAccounts } from "./demo";

/**
 * The demo company's stock, made up but tied to its accounts the way a company on automated (real-time) valuation is:
 *  - cost of goods sold (account 500100) is what deliveries took out of stock each month;
 *  - goods received each month are the change in the stock accounts plus what was delivered (a landed cost each quarter);
 *  - the first month opens with the stock the accounts hold, as an inventory adjustment.
 * So every tie-out on the Inventory pages agrees with the demo accounts, and the demo's purchases (Expenses) are these receipts.
 */
const COGS_ACCOUNT = "500100";
const PRODUCTS: { code: string; name: string; category: string; unit: number; w: number }[] = [
  { code: "OXY-10", name: "Oxygen Concentrator 10L", category: "Respiratory devices", unit: 18000, w: 0.3 },
  { code: "NEB-02", name: "Nebuliser Kit", category: "Respiratory consumables", unit: 900, w: 0.2 },
  { code: "CPM-M", name: "CPAP Mask, Medium", category: "Respiratory consumables", unit: 2500, w: 0.15 },
  { code: "OXI-01", name: "Pulse Oximeter", category: "Monitoring", unit: 1200, w: 0.15 },
  { code: "HUM-C", name: "Humidifier Chamber", category: "Respiratory consumables", unit: 650, w: 0.1 },
  { code: "VNT-C", name: "Ventilator Circuit", category: "Respiratory consumables", unit: 400, w: 0.1 },
];
/** The ventilator circuit stops selling after April 2026, so the demo shows slow stock. */
const SLOW = { code: "VNT-C", lastSale: "2026-04" };
const RENTAL_ITEM = "OXY-10";
const r2 = (v: number) => Math.round(v * 100) / 100;

export interface StockFlow { p: string; cogs: number; receipts: number; landed: number; opening: number }

let flowsCache: StockFlow[] | null = null;
/** Per month: cost of goods delivered, goods received, landed costs, and (first month) the opening stock. */
export function demoStockFlows(): StockFlow[] {
  if (flowsCache) return flowsCache;
  const months = (sample.months as MonthData[]).filter((m) => Object.keys(m.bs).length);
  const cogsAcct = spreadAccounts(months).find((a) => a.code === COGS_ACCOUNT)!;
  const out: StockFlow[] = [];
  months.forEach((m, i) => {
    const inv = Number(m.bs.inventory ?? 0), cogs = r2(cogsAcct.amounts[m.period] ?? 0);
    if (i === 0) { out.push({ p: m.period, cogs, receipts: cogs, landed: 0, opening: inv }); return; }
    const totalIn = r2(inv - Number(months[i - 1].bs.inventory ?? 0) + cogs);
    const landed = /-(03|06|09|12)$/.test(m.period) ? r2(totalIn * 0.03) : 0;
    out.push({ p: m.period, cogs, receipts: r2(totalIn - landed), landed, opening: 0 });
  });
  return (flowsCache = out);
}

/** Splits an amount over weights in whole cents; the last share with a weight takes the remainder, so the parts add up exactly and a zero weight gets nothing. */
function split(total: number, ws: number[]): number[] {
  const sw = ws.reduce((s, w) => s + w, 0);
  const last = ws.reduce((k, w, i) => (w ? i : k), -1);
  let used = 0;
  return ws.map((w, i) => {
    if (!w) return 0;
    const v = i === last ? r2(total - used) : r2((total * w) / sw);
    used = r2(used + v);
    return v;
  });
}

let cache: InventoryData | null = null;
export function demoInventory(): InventoryData {
  if (cache) return cache;
  const layers: LayerRow[] = [], moves: MoveRow[] = [], byRef: InventoryData["byRef"] = [], rental: InventoryData["rental"] = [];
  const seq: Record<string, number> = {};
  const ref = (series: string, p?: string) => `${series}/${p ? `${p.slice(0, 4)}/` : ""}${String((seq[series] = (seq[series] ?? 0) + 1)).padStart(5, "0")}`;
  const qtyOf: Record<string, number> = {}, lastOut: Record<string, string> = {};
  const add = (p: string, kind: LayerRow["kind"], prod: (typeof PRODUCTS)[number], v: number, q: number, r: string, from?: string, to?: string, mk?: MoveRow["kind"]) => {
    layers.push({ p, kind, code: prod.code, product: prod.name, category: prod.category, q, v, n: 1 });
    byRef.push({ p, ref: r, kind, v });
    if (from && to && mk && q) moves.push({ p, kind: mk, code: prod.code, product: prod.name, from, to, q: Math.abs(q), n: 1 });
    qtyOf[prod.code] = (qtyOf[prod.code] ?? 0) + q;
  };
  for (const f of demoStockFlows()) {
    // Products still selling this month (the slow item stops after its last sale).
    const live = PRODUCTS.map((x) => (x.code === SLOW.code && f.p > SLOW.lastSale ? 0 : x.w));
    if (f.opening) split(f.opening, PRODUCTS.map((x) => x.w)).forEach((v, i) => {
      const q = Math.max(1, Math.round(v / PRODUCTS[i].unit));
      add(f.p, "adjustment", PRODUCTS[i], v, q, `INV/OPENING/${PRODUCTS[i].code}`, "Virtual Locations/Inventory adjustment", "WH/Stock", "adjustment");
    });
    split(f.receipts, live).forEach((v, i) => {
      if (!v) return;
      add(f.p, "receipt", PRODUCTS[i], v, Math.max(1, Math.round(v / PRODUCTS[i].unit)), ref("WH/IN"), "Partners/Vendors", "WH/Stock", "receipt");
    });
    if (f.landed) add(f.p, "landed_cost", PRODUCTS[0], f.landed, 0, ref("LC", f.p));
    split(f.cogs, live).forEach((v, i) => {
      if (!v) return;
      const prod = PRODUCTS[i];
      // Never more units out than are in stock.
      const q = Math.min(Math.max(1, Math.round(v / prod.unit)), qtyOf[prod.code] ?? 0);
      add(f.p, "delivery", prod, -v, -q, ref("WH/OUT"), "WH/Stock", "Partners/Customers", "delivery");
      lastOut[productKey(prod.code, prod.name)] = `${f.p}-25`;
    });
    // Two concentrators go out on rental and come back within the month: moves between the company's own locations, no value.
    const out = ref("WH/INT"), back = ref("WH/INT");
    const rent = PRODUCTS.find((x) => x.code === RENTAL_ITEM)!;
    moves.push({ p: f.p, kind: "rental_out", code: rent.code, product: rent.name, from: "WH/Stock", to: "WH/Rental", q: 2, n: 1 });
    moves.push({ p: f.p, kind: "rental_back", code: rent.code, product: rent.name, from: "WH/Rental", to: "WH/Stock", q: 2, n: 1 });
    rental.push({ p: f.p, ref: out }, { p: f.p, ref: back });
  }
  const last = demoStockFlows().at(-1)!.p;
  const asOf = `${last}-${new Date(Date.UTC(Number(last.slice(0, 4)), Number(last.slice(5)), 0)).getUTCDate()}`;
  const valueOf = (code: string) => r2(layers.filter((l) => l.code === code).reduce((s, l) => s + l.v, 0));
  const onhand: OnHand[] = PRODUCTS.map((x) => ({ asOf, product: x.name, code: x.code, location: "WH/Stock", lot: "", qty: qtyOf[x.code] ?? 0, value: valueOf(x.code) }));
  const periods = [...new Set(layers.map((l) => l.p))].sort();
  cache = {
    layers, moves, lastOut, onhand,
    products: PRODUCTS.map((x) => ({ code: x.code, name: x.name, category: x.category, cost: x.unit, type: "Goods" })),
    byRef,
    // The ledger's stock postings carry the same documents and amounts (automated valuation posts each one).
    ledger: byRef.map((r) => ({ p: r.p, ref: r.ref, v: r.v })),
    rental,
    meta: { withIds: true, kinds: ["valuation", "moves", "onhand", "products"], periods },
  };
  return cache;
}

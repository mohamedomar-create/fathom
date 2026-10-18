import type { LayerKind, MoveKind, OnHand, ProductRow } from "@/lib/ingest/inventory";
import { layerKind, isInternalLocation, locationClass, locationTypeOf, productKey, type LocationType, type LocationTypes } from "@/lib/ingest/inventory";
import { addMonths, daysIn, mlabel, money } from "./format";
import { windowFor, type PeriodSel } from "./period";
import { stockBuckets, TIE_TOLERANCE, tieOut, type TieOut } from "./tieout";
import { COGS_SUPPLIER, type ExpensesData } from "./expenses";
import { monthLabel, periodLabel } from "@/lib/i18n";

/**
 * The Inventory module: Odoo's valuation layers, done moves and stock on hand, added up by month, product, kind and
 * location in the database. Values are Odoo's own (company currency, incoming positive, outgoing negative).
 */
export type { LayerKind, MoveKind, OnHand, ProductRow };
export const LAYER_KINDS: readonly LayerKind[] = ["receipt", "delivery", "customer_return", "supplier_return", "landed_cost", "adjustment", "scrap", "revaluation", "other"];
export const MOVE_KINDS: readonly MoveKind[] = ["receipt", "delivery", "customer_return", "supplier_return", "internal", "rental_out", "rental_back", "adjustment", "scrap", "manufacturing"];

/** Per month, product and kind: q quantity, v value, n layers. */
export interface LayerRow { p: string; kind: LayerKind; code: string; product: string; category: string; q: number; v: number; n: number }
/** Per month, product, kind and route: q quantity, n move lines (the detailed records, before they are summarised). */
export interface MoveRow { p: string; kind: MoveKind; code: string; product: string; from: string; to: string; q: number; n: number }

/**
 * The moves as the pages use them, already added up (a busy company has tens of thousands of move lines; the pages need a
 * few thousand numbers):
 *  - months: the months with moves, oldest first;
 *  - byKind: units per month and kind of move;
 *  - flow: units into and out of each location per month;
 *  - asOf: the month stock is placed at (the stock-on-hand date, otherwise the latest month with records);
 *  - byProductLoc: each product's net units in each location up to asOf (moves in, less moves out);
 *  - rentalLocs: the locations rented goods go out to (where rental moves go to, and come back from).
 */
export interface MoveSummary {
  months: string[];
  byKind: { p: string; kind: MoveKind; q: number; n: number }[];
  flow: { p: string; loc: string; inQ: number; outQ: number }[];
  asOf: string | null;
  byProductLoc: { code: string; product: string; loc: string; q: number }[];
  rentalLocs: string[];
  /** The company's location types (from Odoo's export or its own list): which locations hold stock. Not stored with the moves. */
  types?: LocationTypes;
}

/** The stock records as read (valuation by month and product, every move route): what the summary is made from. */
export interface InventoryRecords {
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
  /** Documents of moves to or from the rental location, by month: their value must be 0. */
  rental: { p: string; ref: string }[];
  meta: { withIds: boolean; kinds: string[]; periods: string[] };
}

/** What the Inventory pages read: the records with the moves summarised and the value carried by rental documents worked out. */
export interface InventoryData extends Omit<InventoryRecords, "moves" | "rental"> {
  moves: MoveSummary;
  /** Per month and rental document, the value its valuation rows carry (only documents that carry any). */
  rentalValued: { p: string; ref: string; v: number }[];
}

export const EMPTY_MOVES: MoveSummary = { months: [], byKind: [], flow: [], asOf: null, byProductLoc: [], rentalLocs: [] };
export const EMPTY_RECORDS: InventoryRecords = { layers: [], moves: [], lastOut: {}, onhand: [], products: [], byRef: [], ledger: [], rental: [], meta: { withIds: false, kinds: [], periods: [] } };
export const EMPTY_INVENTORY: InventoryData = { layers: [], moves: EMPTY_MOVES, lastOut: {}, onhand: [], products: [], byRef: [], ledger: [], rentalValued: [], meta: { withIds: false, kinds: [], periods: [] } };

/**
 * The records summarised the way the database summarises them (supabase/migrations/0015: private.inventory_wire), for the
 * demo and the tests.
 */
export function summarizeInventory(r: InventoryRecords): InventoryData {
  const months = [...new Set(r.moves.map((m) => m.p))].sort();
  const kinds = new Map<string, { p: string; kind: MoveKind; q: number; n: number }>();
  const flow = new Map<string, { p: string; loc: string; inQ: number; outQ: number }>();
  for (const m of r.moves) {
    const k = `${m.p}|${m.kind}`;
    const e = kinds.get(k) ?? { p: m.p, kind: m.kind, q: 0, n: 0 };
    e.q += m.q; e.n += m.n; kinds.set(k, e);
    for (const [loc, side] of [[m.to, "inQ"], [m.from, "outQ"]] as const) {
      const fk = `${m.p}|${loc}`;
      const f = flow.get(fk) ?? { p: m.p, loc, inQ: 0, outQ: 0 };
      f[side] += m.q; flow.set(fk, f);
    }
  }
  const lastLayer = r.layers.reduce<string | null>((a, l) => (!a || l.p > a ? l.p : a), null);
  const lastMove = months.at(-1) ?? null;
  const onhandAt = r.onhand.reduce<string | null>((a, o) => (!a || o.asOf > a ? o.asOf : a), null);
  const asOf = onhandAt ? onhandAt.slice(0, 7) : [lastLayer, lastMove].filter((x): x is string => !!x).sort().at(-1) ?? null;
  const net = new Map<string, { code: string; product: string; loc: string; q: number }>();
  if (asOf) for (const m of r.moves) {
    if (m.p > asOf) continue;
    for (const [loc, q] of [[m.to, m.q], [m.from, -m.q]] as const) {
      const k = `${m.code}|${m.product}|${loc}`;
      const e = net.get(k) ?? { code: m.code, product: m.product, loc, q: 0 };
      e.q += q; net.set(k, e);
    }
  }
  const rentalLocs = [...new Set(r.moves.flatMap((m) => (m.kind === "rental_out" ? [m.to] : m.kind === "rental_back" ? [m.from] : [])))].sort();
  const rentalDocs = new Set(r.rental.map((x) => `${x.p}|${x.ref}`));
  const valued = new Map<string, { p: string; ref: string; v: number }>();
  for (const b of r.byRef) {
    if (!rentalDocs.has(`${b.p}|${b.ref}`)) continue;
    const k = `${b.p}|${b.ref}`;
    const e = valued.get(k) ?? { p: b.p, ref: b.ref, v: 0 };
    e.v += Math.abs(b.v); valued.set(k, e);
  }
  const { moves: _m, rental: _r, ...rest } = r;
  void _m; void _r;
  return {
    ...rest,
    moves: { months, byKind: [...kinds.values()], flow: [...flow.values()], asOf: months.length ? asOf : null, byProductLoc: [...net.values()].filter((x) => Math.abs(x.q) > 1e-9), rentalLocs },
    rentalValued: [...valued.values()].filter((x) => x.v !== 0),
  };
}

// ---------------------------------------------------------------- analysis


export interface ProductStat { code: string; product: string; category: string; value: number; qty: number; cogs: number; days: number | null; turnover: number | null; abc: "A" | "B" | "C"; lastOut: string | null; flag: "slow" | "dead" | null }
export interface InventoryFinding { kind: "risk" | "watch"; title: string; text: string }
export interface InventoryBridge { opening: number; receipts: number; landed: number; deliveries: number; returns: number; adjustments: number; revaluation: number; closing: number }
export interface InventoryAnalysis {
  hasValue: boolean;
  hasMoves: boolean;
  /** The valuation export starts after the first month the accounts hold stock: closing value cannot be checked against them. */
  partialValuation: boolean;
  label: string;
  tiles: { value: number | null; days: number | null; cogs: number | null; slow: number | null; dead: number | null };
  bridge: InventoryBridge | null;
  products: ProductStat[];
  movements: { p: string; kind: MoveKind; q: number }[];
  /** The company's locations, with how each counts (stock, transit, rental, outside stock). */
  locations: { loc: string; inQ: number; outQ: number; counts: LocationType }[];
  tieouts: TieOut[];
  /** Where the valued stock is: warehouses, out with customers on rental, in transit (adds up to the stock value). */
  position: StockPosition | null;
  findings: InventoryFinding[];
  headline: string;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const SLOW_DAYS = 90, DEAD_DAYS = 180;
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
const OUT_KINDS = new Set<LayerKind>(["delivery", "customer_return"]);
const IN_KINDS = new Set<LayerKind>(["receipt", "landed_cost", "supplier_return"]);

type Ledger = { stock: Record<string, number> | null; cogs: Record<string, number> | null };
type Refs = { module: Record<string, number>; ledger: Record<string, number> };

/** The stock records indexed once, so a page or the 12-month checks never scan every row per month or per product. */
interface StockIndex {
  /** Months with layers, oldest first, and each one's value by kind. */
  months: string[];
  byMonth: Map<string, Map<LayerKind, number>>;
  refs: Map<string, InventoryData["byRef"]>;
  led: Map<string, { ref: string; v: number; kind: LayerKind }[]>;
  /** Per month, the value each rental document carries. */
  rental: Map<string, Record<string, number>>;
  firstLayer?: string;
  firstMove?: string;
}

const group = <T, K>(xs: T[], key: (x: T) => K) => { const m = new Map<K, T[]>(); for (const x of xs) { const k = key(x); const a = m.get(k); if (a) a.push(x); else m.set(k, [x]); } return m; };

function indexStock(d: InventoryData): StockIndex {
  const weight = new Map<string, number>(), docKind = new Map<string, LayerKind>();
  for (const r of d.byRef) {
    const k = `${r.p}|${r.ref}`;
    if (Math.abs(r.v) >= (weight.get(k) ?? -1)) { weight.set(k, Math.abs(r.v)); docKind.set(k, r.kind); }
  }
  const byMonth = new Map<string, Map<LayerKind, number>>();
  for (const l of d.layers) {
    const m = byMonth.get(l.p) ?? new Map<LayerKind, number>();
    m.set(l.kind, (m.get(l.kind) ?? 0) + l.v); byMonth.set(l.p, m);
  }
  const rental = new Map<string, Record<string, number>>();
  for (const r of d.rentalValued) { const x = rental.get(r.p) ?? {}; x[r.ref] = (x[r.ref] ?? 0) + r.v; rental.set(r.p, x); }
  const months = [...byMonth.keys()].sort();
  return {
    months, byMonth, rental,
    refs: group(d.byRef, (r) => r.p),
    // A ledger posting takes the kind of the module's own document (its move decided it: a return to a supplier on an
    // OUT document is a return, not a delivery); only a document the valuation does not hold is read from its name.
    led: group(d.ledger.map((r) => ({ p: r.p, ref: r.ref, v: r.v, kind: docKind.get(`${r.p}|${r.ref}`) ?? layerKind(r.ref, "", r.v) })), (r) => r.p),
    firstLayer: months[0],
    firstMove: d.moves.months[0],
  };
}

const kindSum = (ix: StockIndex, p: string, kinds?: Set<LayerKind>) => { let v = 0; for (const [k, x] of ix.byMonth.get(p) ?? []) if (!kinds || kinds.has(k)) v += x; return v; };
const closingOf = (ix: StockIndex, p: string) => { let v = 0; for (const m of ix.months) { if (m > p) break; v += kindSum(ix, m); } return v; };

/** The valuation export starts after the first month the accounts hold stock: closing value cannot be checked against them. */
function isPartial(ix: StockIndex, stock: Record<string, number> | null) {
  const firstStock = stock ? Object.keys(stock).filter((p) => Math.abs(stock[p]) > 0.005).sort()[0] : undefined;
  return !!ix.firstLayer && !!firstStock && ix.firstLayer > firstStock;
}

/**
 * The checks against the General Ledger for these months. The documents behind a difference are gathered only when a
 * check is off. A month the ledger does not hold is no_ledger, never off.
 */
function monthTieOuts(d: InventoryData, ix: StockIndex, periods: string[], ledger: Ledger): TieOut[] {
  const out: TieOut[] = [];
  const stock = ledger.stock, hasLedgerRefs = d.ledger.length > 0, partial = isPartial(ix, stock);
  const refsOf = <R extends { ref: string; v: number }>(rows: R[] | undefined, keep: (r: R) => boolean, sign: number, o: Record<string, number> = {}) => {
    for (const r of rows ?? []) if (keep(r)) o[r.ref] = (o[r.ref] ?? 0) + sign * r.v;
    return o;
  };
  const upTo = (p: string): Refs => {
    const mod: Record<string, number> = {}, led: Record<string, number> = {};
    for (const [m, rows] of ix.refs) if (m <= p) refsOf(rows, () => true, 1, mod);
    for (const [m, rows] of ix.led) if (m <= p) refsOf(rows, () => true, 1, led);
    return { module: mod, ledger: led };
  };
  const inMonth = (p: string, kinds?: Set<LayerKind>, sign = 1): Refs => ({
    module: refsOf(ix.refs.get(p), (r) => !kinds || kinds.has(r.kind), sign),
    ledger: refsOf(ix.led.get(p), (r) => !kinds || kinds.has(r.kind), sign),
  });
  // Why a document differs needs every document the stock records and the ledger hold, whatever their month.
  const ever = (m: Map<string, { ref: string }[]>) => new Set([...m.values()].flatMap((rows) => rows.map((r) => r.ref)));
  let reasons: ReturnType<typeof stockBuckets> | undefined;
  const classify: ReturnType<typeof stockBuckets> = (c) => (reasons ??= stockBuckets(ever(ix.refs), ever(ix.led)))(c);
  if (d.layers.length) for (const p of periods) {
    if (!partial) out.push(tieOut("stock_value", p, closingOf(ix, p), stock && p in stock ? stock[p] : null, hasLedgerRefs ? () => upTo(p) : undefined, TIE_TOLERANCE, classify));
    const prev = addMonths(p, -1);
    out.push(tieOut("stock_movement", p, kindSum(ix, p), stock && p in stock && prev in stock ? stock[p] - stock[prev] : null, hasLedgerRefs ? () => inMonth(p) : undefined, TIE_TOLERANCE, classify));
    out.push(tieOut("cogs", p, -kindSum(ix, p, OUT_KINDS), ledger.cogs && p in ledger.cogs ? ledger.cogs[p] : null, hasLedgerRefs ? () => inMonth(p, OUT_KINDS, -1) : undefined));
    // The ledger holds the month when it has stock postings in it or the month's balance sheet is loaded.
    const holds = hasLedgerRefs && (ix.led.has(p) || (!!stock && p in stock));
    out.push(tieOut("receipts", p, kindSum(ix, p, IN_KINDS), holds ? (ix.led.get(p) ?? []).filter((r) => IN_KINDS.has(r.kind)).reduce((s, r) => s + r.v, 0) : null,
      hasLedgerRefs ? () => inMonth(p, IN_KINDS) : undefined));
  }
  if (d.moves.months.length) for (const p of periods) {
    const valued = ix.rental.get(p) ?? {};
    out.push(tieOut("rental_value", p, Object.values(valued).reduce((s, v) => s + v, 0), 0, { module: valued, ledger: {} }));
  }
  return out;
}

/** at: the month stock is placed at (the stock-on-hand date, otherwise the latest month), whatever period is shown. */
export interface StockPosition { warehouse: number; rental: number; transit: number; at: string }

/**
 * Where the valued stock is, and three checks between Odoo's own exports, product by product, at the stock-on-hand date
 * (or the latest month): the units in the warehouses (Odoo's stock list against the moves), the units valued (the
 * valuation against the moves into warehouses, out on rental and in transit), and the valuation against the warehouse value
 * plus what is out on rental and in transit at each product's unit cost. Only when the moves are the whole history.
 */
function positionChecks(d: InventoryData, ix: StockIndex, stock: Record<string, number> | null): { tieouts: TieOut[]; position: StockPosition | null } {
  const none = { tieouts: [], position: null };
  if (!ix.firstMove || !ix.firstLayer || isPartial(ix, stock) || ix.firstMove > ix.firstLayer) return none;
  // The moves are summarised up to this month: each product's net units in each location.
  const pa = d.moves.asOf ?? ix.months.at(-1)!;
  const rentals = d.moves.rentalLocs;
  const add = (o: Record<string, number>, k: string, v: number) => { o[k] = (o[k] ?? 0) + v; };
  const wh: Record<string, number> = {}, rent: Record<string, number> = {}, trans: Record<string, number> = {};
  const into: Record<string, Record<string, number>> = { warehouse: wh, rental_out: rent, transit: trans };
  const cls = new Map<string, Record<string, number> | undefined>();
  for (const m of d.moves.byProductLoc) {
    if (!cls.has(m.loc)) cls.set(m.loc, into[locationClass(m.loc, rentals, d.moves.types)]);
    const to = cls.get(m.loc);
    if (to) add(to, productKey(m.code, m.product), m.q);
  }
  const lq: Record<string, number> = {}, lv: Record<string, number> = {};
  for (const l of d.layers) if (l.p <= pa) { const k = productKey(l.code, l.product); add(lq, k, l.q); add(lv, k, l.v); }
  const keys = new Set([...Object.keys(lq), ...Object.keys(wh), ...Object.keys(rent), ...Object.keys(trans)]);
  const owned: Record<string, number> = {}, unit = (k: string) => (lq[k] ? lv[k] / lq[k] : 0);
  let rental = 0, transit = 0;
  for (const k of keys) {
    owned[k] = (wh[k] ?? 0) + (rent[k] ?? 0) + (trans[k] ?? 0);
    rental += (rent[k] ?? 0) * unit(k); transit += (trans[k] ?? 0) * unit(k);
  }
  const total = (o: Record<string, number>) => Object.values(o).reduce((x, v) => x + v, 0);
  const round = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 10000) / 10000]));
  const books = total(lv);
  const tieouts: TieOut[] = [tieOut("qty_valued", pa, total(lq), total(owned), { module: round(lq), ledger: round(owned) }, 0)];
  if (d.onhand.length) {
    const sq: Record<string, number> = {}, sv: Record<string, number> = {};
    for (const o of d.onhand) { const k = productKey(o.code, o.product); add(sq, k, o.qty); if (o.value !== null) add(sv, k, o.value); }
    // Odoo's stock list counts the warehouses only; the moves into them must give the same units.
    const whOnly = Object.fromEntries(Object.entries(wh).filter(([k, v]) => v || k in sq));
    tieouts.push(tieOut("qty_onhand", pa, total(sq), total(whOnly), { module: round(sq), ledger: round(whOnly) }, 0));
    if (d.onhand.some((o) => o.value !== null)) {
      // A stock list by location (Odoo's Stock report) values the warehouses only, so rental and transit are added; a product
      // list (Product Variants, no location) gives each product's whole valuation, rental and transit already in it.
      const byLoc = new Set(d.onhand.filter((o) => o.location).map((o) => productKey(o.code, o.product)));
      const expected: Record<string, number> = {};
      for (const k of new Set([...Object.keys(lv), ...Object.keys(sv)])) expected[k] = r2((sv[k] ?? 0) + (byLoc.has(k) || !(k in sv) ? ((rent[k] ?? 0) + (trans[k] ?? 0)) * unit(k) : 0));
      tieouts.push(tieOut("onhand_value", pa, books, total(expected), { module: Object.fromEntries(Object.entries(lv).map(([k, v]) => [k, r2(v)])), ledger: expected }));
    }
  }
  return { tieouts, position: { warehouse: r2(books - rental - transit), rental: r2(rental), transit: r2(transit), at: pa } };
}

/** Checks against the accounts (the internal ones, rentals and quantities, are not counted as "agreeing with the accounts"). */
const ACCOUNT_CHECKS = new Set(["stock_value", "stock_movement", "cogs", "receipts"]);
/** A check counted in units, not money. */
export const isUnitCheck = (key: string) => key.startsWith("qty_");
/** A check between Odoo's own exports (units, value by location, rentals), not against the accounts. */
export const isInsideCheck = (key: string) => !ACCOUNT_CHECKS.has(key);
export function tieSummary(tieouts: TieOut[]): { off: TieOut[]; agreed: number; checked: number } {
  const acc = tieouts.filter((t) => ACCOUNT_CHECKS.has(t.key) && t.status !== "no_ledger");
  return { off: tieouts.filter((t) => t.status === "off"), agreed: acc.filter((t) => t.status === "ok").length, checked: acc.length };
}

/**
 * The Inventory pages for a period: stock value and how it moved, products, movements, findings, and the tie-outs that
 * check every month against the General Ledger.
 *  - ledger.stock: closing balance of the accounts mapped to Inventory, per month (the balance sheet);
 *  - ledger.cogs: cost of sales posted by stock moves, per month (expense lines grouped as "Cost of goods sold (stock)").
 */
export function inventoryAnalysis(
  d: InventoryData, sel: PeriodSel, fyStart: number,
  opts: { ledger: { stock: Record<string, number> | null; cogs: Record<string, number> | null }; revenue?: Record<string, number>; lang?: "en" | "ar"; today?: string; cur?: string },
): InventoryAnalysis {
  const ar = opts.lang === "ar";
  const L = (en: string, a: string) => (ar ? a : en);
  const cur = opts.cur ?? "EGP";
  const fmt = (v: number) => money(r2(v), cur);
  const ml = (p: string) => (ar ? monthLabel(p, "ar") : mlabel(p));
  const window = windowFor(sel, fyStart);
  const periods = window.periods, start = periods[0], end = periods[periods.length - 1];
  const inWin = new Set(periods);
  const label = ar ? periodLabel(window.label, "ar") : window.label;
  const hasValue = d.layers.length > 0, hasMoves = d.moves.months.length > 0;
  const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);

  // ---- value: closing is every layer up to the month end; the bridge splits the period's layers by kind
  const ix = indexStock(d);
  const closingAt = (p: string) => closingOf(ix, p);
  const win = d.layers.filter((l) => inWin.has(l.p));
  const byKind = (ks: LayerKind[], rows = win) => sum(rows.filter((l) => ks.includes(l.kind)), (l) => l.v);
  const bridge: InventoryBridge | null = hasValue ? {
    opening: r2(sum(d.layers.filter((l) => l.p < start), (l) => l.v)),
    receipts: r2(byKind(["receipt"])), landed: r2(byKind(["landed_cost"])), deliveries: r2(byKind(["delivery"])),
    returns: r2(byKind(["customer_return", "supplier_return"])), adjustments: r2(byKind(["adjustment", "scrap", "other"])), revaluation: r2(byKind(["revaluation"])),
    closing: r2(closingAt(end)),
  } : null;
  const cogs = hasValue ? r2(-byKind(["delivery", "customer_return"])) : null;
  // Days covered: a part month counts to its cut-off (opts.today), as the KPIs do.
  const cut = opts.today && opts.today.startsWith(end) ? Number(opts.today.slice(8)) : 0;
  const daysWin = sum(periods, daysIn) - (cut > 0 && cut < daysIn(end) ? daysIn(end) - cut : 0);
  const value = bridge ? bridge.closing : null;
  // Days of stock, as on the KPI and Banking pages: average stock (opening and each month end) ÷ cost of sales × days.
  const avgStock = bridge ? (bridge.opening + sum(periods, closingAt)) / (periods.length + 1) : null;

  // ---- products
  const today = opts.today ?? `${end}-${String(daysIn(end)).padStart(2, "0")}`;
  // Each product's layers added up in one pass (a product with no internal reference is keyed by its name).
  const acc = new Map<string, { code: string; product: string; category: string; v: number; q: number; c: number; firstIn?: string }>();
  for (const l of d.layers) {
    if (l.p > end) continue;
    const k = productKey(l.code, l.product);
    const x = acc.get(k) ?? { code: l.code, product: l.product, category: l.category, v: 0, q: 0, c: 0 };
    x.v += l.v; x.q += l.q; x.product = l.product; x.category = l.category;
    if (inWin.has(l.p) && OUT_KINDS.has(l.kind)) x.c -= l.v;
    if (l.q > 0 && (!x.firstIn || l.p < x.firstIn)) x.firstIn = l.p;
    acc.set(k, x);
  }
  const stats = [...acc.entries()].map(([k, x]) => {
    const v = r2(x.v), q = Math.round(x.q * 10000) / 10000, c = r2(x.c);
    const lastOut = d.lastOut[k] ?? null;
    const idle = lastOut ? dayDiff(today, lastOut) : x.firstIn ? dayDiff(today, `${x.firstIn}-01`) : 0;
    const flag: ProductStat["flag"] = v > 0 ? (idle >= DEAD_DAYS ? "dead" : idle >= SLOW_DAYS ? "slow" : null) : null;
    return { code: x.code, product: x.product, category: x.category, value: v, qty: q, cogs: c, days: c > 0 ? Math.round(v / (c / daysWin)) : null,
      turnover: v > 0 && c > 0 ? r2((c * 365 / daysWin) / v) : null, abc: "C" as ProductStat["abc"], lastOut, flag };
  });
  const totalCogs = sum(stats.filter((s) => s.cogs > 0), (s) => s.cogs);
  let cum = 0;
  for (const s of [...stats].sort((a, b) => b.cogs - a.cogs)) {
    if (totalCogs > 0 && s.cogs > 0) s.abc = cum / totalCogs < 0.8 ? "A" : cum / totalCogs < 0.95 ? "B" : "C";
    cum += Math.max(s.cogs, 0);
  }
  const products = stats.sort((a, b) => b.value - a.value);
  const slow = hasValue ? r2(sum(products.filter((p) => p.flag === "slow"), (p) => p.value)) : null;
  const dead = hasValue ? r2(sum(products.filter((p) => p.flag === "dead"), (p) => p.value)) : null;

  // ---- movements and locations (quantities)
  const mv = new Map<string, { p: string; kind: MoveKind; q: number }>();
  const locs = new Map<string, { loc: string; inQ: number; outQ: number; counts: LocationType }>();
  for (const m of d.moves.byKind) {
    if (!inWin.has(m.p)) continue;
    const k = `${m.p}|${m.kind}`;
    const e = mv.get(k) ?? { p: m.p, kind: m.kind, q: 0 };
    e.q += m.q; mv.set(k, e);
  }
  const counts = new Map<string, LocationType | null>();
  for (const f of d.moves.flow) {
    if (!inWin.has(f.p)) continue;
    if (!counts.has(f.loc)) counts.set(f.loc, locationTypeOf(f.loc, d.moves.rentalLocs, d.moves.types));
    const c = counts.get(f.loc);
    if (!c) continue;
    const l = locs.get(f.loc) ?? { loc: f.loc, inQ: 0, outQ: 0, counts: c };
    l.inQ += f.inQ; l.outQ += f.outQ; locs.set(f.loc, l);
  }

  // ---- tie-outs, month by month
  const partialValuation = hasValue && isPartial(ix, opts.ledger.stock);
  const tieouts = monthTieOuts(d, ix, periods, opts.ledger);
  const pos = hasValue && hasMoves ? positionChecks(d, ix, opts.ledger.stock) : { tieouts: [], position: null };
  tieouts.push(...pos.tieouts);

  // ---- findings
  const findings: InventoryFinding[] = [];
  const NAME: Record<string, [string, string]> = {
    stock_value: ["Stock value", "قيمة المخزون"], stock_movement: ["Stock movement", "حركة المخزون"], cogs: ["Cost of sales from deliveries", "تكلفة المبيعات من التسليمات"],
    receipts: ["Receipts and landed costs", "الاستلامات والتكاليف الواصلة"], rental_value: ["Rental moves", "حركات التأجير"], qty_onhand: ["Units in the warehouses", "الوحدات في المخازن"],
    qty_valued: ["Units valued", "الوحدات المقيّمة"], onhand_value: ["Stock value by location", "قيمة المخزون حسب الموقع"],
  };
  // What each check inside Odoo's own exports means when it differs, and where to look.
  const INSIDE: Record<string, { title: [string, string]; a: [string, string]; b: [string, string]; why: [string, string] }> = {
    qty_valued: { title: ["Odoo's valuation and its moves disagree on units", "تقييم Odoo وحركاته مختلفان في عدد الوحدات"], a: ["the valuation holds", "التقييم يحمل"], b: ["the moves", "الحركات"],
      why: ["Usually moves done while a product was not tracked in stock, or receipts posted without value. The stock value uses the valuation.", "غالبًا حركات تمت والصنف غير متتبع في المخزون، أو استلامات سُجّلت بلا قيمة. قيمة المخزون تعتمد على التقييم."] },
    qty_onhand: { title: ["Odoo's stock list and its moves disagree on units", "قائمة مخزون Odoo وحركاته مختلفتان في عدد الوحدات"], a: ["the stock list shows", "قائمة المخزون تُظهر"], b: ["the moves into the warehouses", "الحركات إلى المخازن"],
      why: ["Usually moves done while a product was not tracked in stock. Check these products' history in Odoo.", "غالبًا حركات تمت والصنف غير متتبع في المخزون. راجع تاريخ هذه الأصناف في Odoo."] },
    onhand_value: { title: ["Stock value and Odoo's product list differ", "قيمة المخزون وقائمة أصناف Odoo مختلفتان"], a: ["the valuation is", "التقييم"], b: ["warehouses + on rental + in transit", "المخازن + التأجير + النقل"],
      why: ["Usually a product missing from the list (archived) or a negative value left in the valuation.", "غالبًا صنف غير موجود في القائمة (مؤرشف) أو قيمة سالبة متبقية في التقييم."] },
    rental_value: { title: ["Rental moves carry value", "حركات التأجير تحمل قيمة"], a: ["rental documents carry", "مستندات التأجير تحمل"], b: ["expected", "المتوقع"],
      why: ["Renting out should move goods, not their value: check these documents in Odoo.", "التأجير يجب أن ينقل البضاعة لا قيمتها: راجع هذه المستندات في Odoo."] },
  };
  for (const t of tieouts.filter((x) => x.status === "off")) {
    const [en, a] = NAME[t.key];
    const units = isUnitCheck(t.key);
    const f = (v: number) => (units ? String(r2(v)) : fmt(v));
    const causes = t.causes.slice(0, 3).map((c) => `${c.ref} (${f(c.module - c.ledger)})`).join(", ");
    const inside = INSIDE[t.key];
    findings.push(inside ? {
      kind: "watch",
      title: L(inside.title[0], inside.title[1]),
      text: L(`${inside.a[0][0].toUpperCase()}${inside.a[0].slice(1)} ${f(t.module)}, ${inside.b[0]} ${f(t.ledger ?? 0)}.${causes ? ` Largest: ${causes}.` : ""} ${inside.why[0]}`,
        `${inside.a[1]} ${f(t.module)}، ${inside.b[1]} ${f(t.ledger ?? 0)}.${causes ? ` الأكبر: ${causes}.` : ""} ${inside.why[1]}`),
    } : {
      kind: "risk",
      title: L(`${en} differs from the accounts in ${ml(t.period)}`, `${a} يختلف عن الحسابات في ${ml(t.period)}`),
      text: L(`Inventory shows ${f(t.module)}, the accounts ${f(t.ledger ?? 0)}: a difference of ${f(t.diff ?? 0)}.${causes ? ` Largest: ${causes}.` : ""}`,
        `المخزون يظهر ${f(t.module)} والحسابات ${f(t.ledger ?? 0)}: فرق ${f(t.diff ?? 0)}.${causes ? ` الأكبر: ${causes}.` : ""}`),
    });
  }
  const negative = d.onhand.filter((o) => o.qty < 0);
  if (negative.length) findings.push({
    kind: "risk",
    title: L(`Negative stock on hand for ${negative.length} item${negative.length > 1 ? "s" : ""}`, `رصيد مخزون سالب لعدد من الأصناف: ${negative.length}`),
    text: L(`${negative.slice(0, 3).map((o) => `${o.code || o.product} (${o.qty})`).join(", ")}: goods were delivered before they were received in Odoo, so their cost may be wrong.`,
      `${negative.slice(0, 3).map((o) => `${o.code || o.product} (${o.qty})`).join("، ")}: سُلّمت بضاعة قبل استلامها في Odoo، فقد تكون تكلفتها غير صحيحة.`),
  });
  const adj = -byKind(["adjustment", "scrap"]);
  if (cogs && cogs > 0 && adj / cogs > 0.01) findings.push({
    kind: "watch",
    title: L(`Adjustments and scrap are ${((adj / cogs) * 100).toFixed(1)}% of cost of sales`, `التسويات والهالك ${((adj / cogs) * 100).toFixed(1)}% من تكلفة المبيعات`),
    text: L(`${fmt(adj)} of stock written off or adjusted in ${label}. Check the counts and the reasons in Odoo.`, `${fmt(adj)} من المخزون شُطب أو سُوّي في ${label}. راجع الجرد والأسباب في Odoo.`),
  });
  if (value && value > 0 && slow !== null && dead !== null && (slow + dead) / value > 0.1) findings.push({
    kind: "watch",
    title: L(`${Math.round(((slow + dead) / value) * 100)}% of stock has not moved for 90 days or more`, `${Math.round(((slow + dead) / value) * 100)}% من المخزون لم يتحرك منذ 90 يومًا أو أكثر`),
    text: L(`${fmt(slow + dead)} of stock: ${fmt(dead)} has not gone out for 180 days. Consider promotions, returns to suppliers or write-downs.`, `${fmt(slow + dead)} من المخزون، منها ${fmt(dead)} لم تخرج منذ 180 يومًا. فكّر في عروض أو إرجاع للموردين أو تخفيض القيمة.`),
  });
  if (hasValue && opts.revenue) {
    const ago = addMonths(end, -3);
    const v0 = closingAt(ago), v1 = closingAt(end);
    const rev = (from: number, to: number) => { let s = 0, n = 0; for (let i = from; i < to; i++) { const p = addMonths(end, -i); if (p in opts.revenue!) { s += opts.revenue![p]; n++; } } return n === 3 ? s : null; };
    const r1 = rev(0, 3), r0 = rev(3, 6);
    if (v0 > 0 && r0 && r1 !== null) {
      const sg = v1 / v0 - 1, rg = r1 / r0 - 1;
      if (sg - rg >= 0.1) findings.push({
        kind: "watch",
        title: L("Stock is growing faster than sales", "المخزون ينمو أسرع من المبيعات"),
        text: L(`Over the last three months stock rose ${(sg * 100).toFixed(0)}% while sales changed ${(rg * 100).toFixed(0)}%: cash is being tied up in goods.`,
          `خلال الأشهر الثلاثة الأخيرة ارتفع المخزون ${(sg * 100).toFixed(0)}% بينما تغيرت المبيعات ${(rg * 100).toFixed(0)}%: النقدية تُحتجز في البضاعة.`),
      });
    }
  }

  const change = bridge ? bridge.closing - bridge.opening : 0;
  const headline = bridge
    ? L(`Stock is worth ${fmt(bridge.closing)} at the end of ${label}, ${change >= 0 ? "up" : "down"} ${fmt(Math.abs(change))} over the period. Goods delivered cost ${fmt(cogs ?? 0)}.`,
      `قيمة المخزون ${fmt(bridge.closing)} في نهاية ${label}، ${change >= 0 ? "بزيادة" : "بانخفاض"} ${fmt(Math.abs(change))} خلال الفترة. تكلفة البضاعة المسلّمة ${fmt(cogs ?? 0)}.`)
    : hasMoves ? L(`Stock movements for ${label} are loaded. Upload the valuation export to see values and check them against the accounts.`, `حركات المخزون لـ ${label} محمّلة. ارفع تقرير التقييم لرؤية القيم ومطابقتها مع الحسابات.`)
    : L("No stock records loaded yet.", "لا توجد سجلات مخزون بعد.");

  return {
    hasValue, hasMoves, partialValuation, label, position: pos.position,
    tiles: { value, days: avgStock !== null && avgStock >= 0 && cogs && cogs > 0 ? Math.round((avgStock / cogs) * daysWin) : null, cogs, slow, dead },
    bridge, products, movements: [...mv.values()].map((m) => ({ ...m, q: Math.round(m.q * 10000) / 10000 })), locations: [...locs.values()],
    tieouts, findings, headline,
  };
}

/**
 * The ledger side of the tie-outs, from data every company already has: the closing balance of the accounts mapped to
 * Inventory (balance sheet, per month) and the cost of sales posted by stock moves or with customer invoices (the expense
 * lines grouped as "Cost of goods sold (stock)").
 */
/** Odoo's stock interim (delivered) account: goods delivered whose cost waits for the customer invoice. */
const DELIVERED_INTERIM = /interim.*deliver|deliver.*interim|مخزون مؤقت.*(مسلم|تسليم)/i;

export function inventoryLedger(months: { period: string; bs: Partial<Record<string, number>> }[], expenses: { suppliers: { p: string; s: string; c: string | null; a: number }[]; sources?: Record<string, "ledger" | "file"> }, accounts: { name: string; cls: string; amounts: Record<string, number> }[] = []): { stock: Record<string, number> | null; cogs: Record<string, number> | null } {
  const stock: Record<string, number> = {};
  for (const m of months) if (Object.keys(m.bs).length) stock[m.period] = Number(m.bs.inventory ?? 0);
  // A month with expense lines is in the ledger: its cost of sales from stock is what was posted there, 0 when nothing was.
  const cogs: Record<string, number> = {};
  // A month whose expense lines come from a purchases file shows that file, not the ledger: its cost of sales is unknown.
  for (const r of expenses.suppliers) if (expenses.sources?.[r.p] !== "file") cogs[r.p] = r2((cogs[r.p] ?? 0) + (r.s === COGS_SUPPLIER && (r.c === "cos_variable" || r.c === "cos_fixed") ? r.a : 0));
  // Goods delivered but not yet invoiced are in the stock interim (delivered) account, not yet in cost of sales: the cost of
  // what left the stock is the cost of sales posted plus that account's change. A month whose opening balance is unknown is
  // not checked.
  const interim = accounts.filter((a) => DELIVERED_INTERIM.test(a.name) && !["revenue", "cos_variable", "cos_fixed"].includes(a.cls));
  if (interim.length) for (const p of Object.keys(cogs)) {
    const prev = addMonths(p, -1);
    if (!months.some((m) => m.period === prev && Object.keys(m.bs).length)) { delete cogs[p]; continue; }
    cogs[p] = r2(cogs[p] + interim.reduce((x, a) => x + (a.amounts[p] ?? 0) - (a.amounts[prev] ?? 0), 0));
  }
  return { stock: Object.keys(stock).length ? stock : null, cogs: Object.keys(cogs).length ? cogs : null };
}

/**
 * The part of the expense summary the Inventory pages use: the stock cost of sales rows, and one empty row for each other
 * month the ledger holds (its cost of sales from stock is 0). The rest of the summary is never sent to those pages.
 */
export function forInventory(e: ExpensesData): ExpensesData {
  const keep = e.suppliers.filter((r) => r.s === COGS_SUPPLIER);
  const has = new Set(keep.map((r) => r.p));
  const empty = [...new Set(e.suppliers.map((r) => r.p))].filter((p) => !has.has(p)).map((p) => ({ p, s: "", j: "", c: null, a: 0, d: 0, n: 0 }));
  return { ...e, suppliers: [...keep, ...empty], accounts: [], flags: [] };
}

const sumV = (rows: LayerRow[]) => rows.reduce((s, l) => s + l.v, 0);

/** One month's stock value: where it opened, what each kind of layer added or took, and where it closed (adds up exactly). */
export function monthBridge(d: InventoryData, p: string): InventoryBridge {
  const rows = d.layers.filter((l) => l.p === p);
  const k = (ks: LayerKind[]) => r2(sumV(rows.filter((l) => ks.includes(l.kind))));
  return {
    opening: r2(sumV(d.layers.filter((l) => l.p < p))),
    receipts: k(["receipt"]), landed: k(["landed_cost"]), deliveries: k(["delivery"]), returns: k(["customer_return", "supplier_return"]),
    adjustments: k(["adjustment", "scrap", "other"]), revaluation: k(["revaluation"]),
    closing: r2(sumV(d.layers.filter((l) => l.p <= p))),
  };
}

/** The n months up to the end: closing stock value, cost of goods delivered (net of customer returns) and goods received (landed costs and supplier returns included). */
export function inventoryMonthly(d: InventoryData, end: string, n = 12): { p: string; closing: number; cogs: number; received: number }[] {
  return Array.from({ length: n }, (_, i) => addMonths(end, i - n + 1)).map((p) => {
    const rows = d.layers.filter((l) => l.p === p);
    return {
      p, closing: r2(sumV(d.layers.filter((l) => l.p <= p))),
      cogs: r2(-sumV(rows.filter((l) => OUT_KINDS.has(l.kind)))) || 0,
      received: r2(sumV(rows.filter((l) => IN_KINDS.has(l.kind)))),
    };
  });
}

/** What one unit cost when received, per product and month (value ÷ quantity of receipt layers); null in a month with no receipts. */
/** keys: products as productKey gives them ("[code] name", or the name alone when there is no internal reference). */
/**
 * A month whose receipts cost under 5% of the product's usual (median) receipt cost is set aside in odd ("check receipt"):
 * a receipt entered at a token price and revalued later must not read as a price rise of thousands of percent.
 */
export function receiptCost(d: InventoryData, keys: string[], periods: string[]): { code: string; product: string; points: (number | null)[]; odd: string[] }[] {
  return keys.map((code) => {
    const rows = d.layers.filter((l) => productKey(l.code, l.product) === code && l.kind === "receipt" && l.q > 0);
    const unit = (p: string) => { const m = rows.filter((l) => l.p === p); const q = m.reduce((s, l) => s + l.q, 0); return q > 0 ? sumV(m) / q : null; };
    const all = [...new Set(rows.map((l) => l.p))].map(unit).filter((v): v is number => v !== null).sort((a, b) => a - b);
    const median = all.length ? (all[(all.length - 1) >> 1] + all[all.length >> 1]) / 2 : 0;
    const odd: string[] = [];
    const points = periods.map((p) => { const u = unit(p); if (u !== null && u < median * 0.05) { odd.push(p); return null; } return u === null ? null : r2(u); });
    return { code, product: rows[rows.length - 1]?.product ?? code, points, odd };
  });
}

/** Every tie-out, once per check and month, over the last n months with stock records (for readiness and Data health). */
export function inventoryTieOuts(d: InventoryData, ledger: Ledger, fyStart: number, n = 12): TieOut[] {
  void fyStart;
  const ix = indexStock(d);
  const months = [...new Set([...ix.months, ...d.moves.months])].sort().slice(-n);
  const out = monthTieOuts(d, ix, months, ledger);
  if (d.layers.length && d.moves.months.length) out.push(...positionChecks(d, ix, ledger.stock).tieouts);
  return out.sort((a, b) => a.period.localeCompare(b.period));
}

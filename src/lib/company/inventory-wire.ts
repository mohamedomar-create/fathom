import { EMPTY_INVENTORY, LAYER_KINDS, MOVE_KINDS, type InventoryData, type LayerKind, type MoveKind } from "@/lib/engine/inventory";

/**
 * The Inventory summary as the database keeps it ready (supabase/migrations/0015: private.inventory_wire), in a compact
 * form: rows are arrays, and each product is written once and referred to by its position. This keeps what a page loads
 * small; the browser turns it back into InventoryData.
 */
export interface InventoryWire {
  v: 2;
  /** [internal reference, name, category] */
  prods: [string, string, string][];
  /** [month, kind, product, quantity, value, rows] */
  layers: [string, string, number, number, number, number][];
  /** Moves: [month, kind, quantity, rows] */
  mk: [string, string, number, number][];
  /** [month, location, units in, units out] */
  flow: [string, string, number, number][];
  /** [product, location, net units up to asOf] */
  pl: [number, string, number][];
  asOf: string | null;
  moveMonths: string[];
  rentalLocs: string[];
  lastOut: Record<string, string>;
  /** [as of, name, internal reference, location, lot, quantity, value] */
  onhand: [string, string, string, string, string, number, number | null][];
  /** [internal reference, name, category, cost, type] */
  products: [string, string, string, number | null, string][];
  /** [month, document, kind, value] */
  byRef: [string, string, string, number][];
  /** [month, document, value] */
  ledger: [string, string, number][];
  /** Rental documents carrying value: [month, document, value] */
  rv: [string, string, number][];
  meta: { withIds: boolean; kinds: string[]; periods: string[] };
}

/** What a page receives: the summary (when one is ready), whether a newer one is being prepared, and a build error. */
export interface InventoryState { wire: unknown; pending: boolean; error: string | null; builtAt: string | null }
export const NO_INVENTORY_STATE: InventoryState = { wire: null, pending: false, error: null, builtAt: null };

const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : 0);
const nOrNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : n(v));
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const arr = (v: unknown): unknown[][] => (Array.isArray(v) ? v.filter(Array.isArray) as unknown[][] : []);
const strs = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
const layerKind = (v: unknown): LayerKind => ((LAYER_KINDS as readonly string[]).includes(String(v)) ? (v as LayerKind) : "other");
const moveKind = (v: unknown): MoveKind => ((MOVE_KINDS as readonly string[]).includes(String(v)) ? (v as MoveKind) : "internal");

/** The summary from the database, made safe: a missing or non-numeric value is 0 (null where null means "not given"). */
export function fromWire(raw: unknown): InventoryData {
  if (!raw || typeof raw !== "object") return EMPTY_INVENTORY;
  const o = raw as Record<string, unknown>;
  const prods = arr(o.prods).map((p) => [s(p[0]), s(p[1]), s(p[2])] as const);
  const prod = (i: unknown) => prods[n(i)] ?? (["", "", ""] as const);
  const meta = (o.meta ?? {}) as Record<string, unknown>;
  const lastOut = o.lastOut && typeof o.lastOut === "object" ? (o.lastOut as Record<string, unknown>) : {};
  return {
    layers: arr(o.layers).map((r) => { const [code, product, category] = prod(r[2]); return { p: s(r[0]), kind: layerKind(r[1]), code, product, category, q: n(r[3]), v: n(r[4]), n: n(r[5]) }; }),
    moves: {
      months: strs(o.moveMonths),
      byKind: arr(o.mk).map((r) => ({ p: s(r[0]), kind: moveKind(r[1]), q: n(r[2]), n: n(r[3]) })),
      flow: arr(o.flow).map((r) => ({ p: s(r[0]), loc: s(r[1]), inQ: n(r[2]), outQ: n(r[3]) })),
      asOf: typeof o.asOf === "string" && o.asOf ? o.asOf.slice(0, 7) : null,
      byProductLoc: arr(o.pl).map((r) => { const [code, product] = prod(r[0]); return { code, product, loc: s(r[1]), q: n(r[2]) }; }),
      rentalLocs: strs(o.rentalLocs),
    },
    lastOut: Object.fromEntries(Object.entries(lastOut).map(([k, v]) => [k, s(v).slice(0, 10)])),
    onhand: arr(o.onhand).map((r) => ({ asOf: s(r[0]).slice(0, 10), product: s(r[1]), code: s(r[2]), location: s(r[3]), lot: s(r[4]), qty: n(r[5]), value: nOrNull(r[6]) })),
    products: arr(o.products).map((r) => ({ code: s(r[0]), name: s(r[1]), category: s(r[2]), cost: nOrNull(r[3]), type: s(r[4]) })),
    byRef: arr(o.byRef).map((r) => ({ p: s(r[0]), ref: s(r[1]), kind: layerKind(r[2]), v: n(r[3]) })),
    ledger: arr(o.ledger).map((r) => ({ p: s(r[0]), ref: s(r[1]), v: n(r[2]) })),
    rentalValued: arr(o.rv).map((r) => ({ p: s(r[0]), ref: s(r[1]), v: n(r[2]) })),
    meta: { withIds: meta.withIds === true, kinds: strs(meta.kinds), periods: strs(meta.periods) },
  };
}

/** The same compact form made from a summary (the demo company, the tests). */
export function toWire(d: InventoryData): InventoryWire {
  const index = new Map<string, number>();
  const prods: InventoryWire["prods"] = [];
  const at = (code: string, product: string, category = "") => {
    const k = `${code}\u0000${product}`;
    let i = index.get(k);
    if (i === undefined) { i = prods.length; index.set(k, i); prods.push([code, product, category]); }
    else if (category > prods[i][2]) prods[i][2] = category;
    return i;
  };
  return {
    v: 2,
    prods,
    layers: d.layers.map((l) => [l.p, l.kind, at(l.code, l.product, l.category), l.q, l.v, l.n]),
    mk: d.moves.byKind.map((m) => [m.p, m.kind, m.q, m.n]),
    flow: d.moves.flow.map((f) => [f.p, f.loc, f.inQ, f.outQ]),
    pl: d.moves.byProductLoc.map((x) => [at(x.code, x.product), x.loc, x.q]),
    asOf: d.moves.asOf,
    moveMonths: d.moves.months,
    rentalLocs: d.moves.rentalLocs,
    lastOut: d.lastOut,
    onhand: d.onhand.map((o) => [o.asOf, o.product, o.code, o.location, o.lot, o.qty, o.value]),
    products: d.products.map((p) => [p.code, p.name, p.category, p.cost, p.type]),
    byRef: d.byRef.map((r) => [r.p, r.ref, r.kind, r.v]),
    ledger: d.ledger.map((r) => [r.p, r.ref, r.v]),
    rv: d.rentalValued.map((r) => [r.p, r.ref, r.v]),
    meta: d.meta,
  };
}

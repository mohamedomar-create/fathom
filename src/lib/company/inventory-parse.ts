import { EMPTY_INVENTORY, LAYER_KINDS, MOVE_KINDS, type InventoryData, type LayerKind, type MoveKind } from "@/lib/engine/inventory";

/** Numbers from the database summary, made safe: a missing or non-numeric value is 0 (null where null means "not given"). */
const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : 0);
const nOrNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : n(v));
const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const layerKind = (v: unknown): LayerKind => ((LAYER_KINDS as readonly string[]).includes(String(v)) ? (v as LayerKind) : "other");
const moveKind = (v: unknown): MoveKind => ((MOVE_KINDS as readonly string[]).includes(String(v)) ? (v as MoveKind) : "internal");
type Rows = Record<string, unknown>[];

export function parseInventorySummary(raw: unknown): InventoryData {
  if (!raw || typeof raw !== "object") return EMPTY_INVENTORY;
  const o = raw as { layers?: Rows; moves?: Rows; last_out?: Record<string, unknown>; onhand?: Rows; products?: Rows; byRef?: Rows; ledger?: Rows; meta?: Record<string, unknown> };
  const meta = o.meta ?? {};
  return {
    layers: (o.layers ?? []).map((r) => ({ p: s(r.p), kind: layerKind(r.kind), code: s(r.code), product: s(r.product), category: s(r.category), q: n(r.q), v: n(r.v), n: n(r.n) })),
    moves: (o.moves ?? []).map((r) => ({ p: s(r.p), kind: moveKind(r.kind), code: s(r.code), product: s(r.product), from: s(r.from), to: s(r.to), q: n(r.q), n: n(r.n) })),
    lastOut: Object.fromEntries(Object.entries(o.last_out ?? {}).map(([k, v]) => [k, s(v).slice(0, 10)])),
    onhand: (o.onhand ?? []).map((r) => ({ asOf: s(r.asOf).slice(0, 10), product: s(r.product), code: s(r.code), location: s(r.location), lot: s(r.lot), qty: n(r.qty), value: nOrNull(r.value) })),
    products: (o.products ?? []).map((r) => ({ code: s(r.code), name: s(r.name), category: s(r.category), cost: nOrNull(r.cost), type: s(r.type) })),
    byRef: (o.byRef ?? []).map((r) => ({ p: s(r.p), ref: s(r.ref), kind: layerKind(r.kind), v: n(r.v) })),
    ledger: (o.ledger ?? []).map((r) => ({ p: s(r.p), ref: s(r.ref), v: n(r.v) })),
    meta: { withIds: meta.withIds === true, kinds: Array.isArray(meta.kinds) ? meta.kinds.map(String) : [], periods: Array.isArray(meta.periods) ? meta.periods.map(String) : [] },
  };
}

// Inventory to standard (Phase 3b): ABC on a rolling 12 months, stock by location at any month end, and a history of
// units and value. Pure, from the summary the Inventory pages already hold.
import { addMonths } from "./format";
import { locationTypeOf, productKey, type LocationType } from "@/lib/ingest/inventory";
import type { InventoryData } from "./inventory";

const r2 = (v: number) => Math.round(v * 100) / 100;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/**
 * ABC by cost of sales over the 12 months to `end` (A: the products making the first 80% of it, B: the next 15%, C: the
 * rest). A product with no deliveries in those 12 months has no class.
 */
export function rollingAbc(d: InventoryData, end: string): Map<string, "A" | "B" | "C"> {
  const start = addMonths(end, -11);
  const cogs = new Map<string, number>();
  for (const l of d.layers) {
    if (l.p < start || l.p > end || (l.kind !== "delivery" && l.kind !== "customer_return")) continue;
    const k = productKey(l.code, l.product);
    cogs.set(k, (cogs.get(k) ?? 0) - l.v);
  }
  const rows = [...cogs].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((s, [, c]) => s + c, 0);
  const out = new Map<string, "A" | "B" | "C">();
  let cum = 0;
  for (const [k, c] of rows) { out.set(k, cum / total < 0.8 ? "A" : cum / total < 0.95 ? "B" : "C"); cum += c; }
  return out;
}

/** Units in each location that holds stock (warehouses, transit, out on rental) at the end of `end`, from the moves. */
export function positionAt(d: InventoryData, end: string): { loc: string; type: LocationType; units: number }[] {
  const by = new Map<string, number>();
  for (const f of d.moves.flow) if (f.p <= end) by.set(f.loc, (by.get(f.loc) ?? 0) + f.inQ - f.outQ);
  const out: { loc: string; type: LocationType; units: number }[] = [];
  for (const [loc, q] of by) {
    const type = locationTypeOf(loc, d.moves.rentalLocs, d.moves.types);
    if ((type === "internal" || type === "transit" || type === "rental") && Math.abs(q) > 1e-9) out.push({ loc, type, units: r4(q) });
  }
  const order: LocationType[] = ["internal", "transit", "rental", "outside"];
  return out.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || b.units - a.units);
}

/** units and value are null for a month before the first stock record, or with no valuation loaded (missing, not 0). */
export interface HistoryPoint { p: string; units: number | null; value: number | null; byCategory: Record<string, { units: number; value: number }>; byLocation: Record<string, number> }

/** Units and value at each of the `n` month ends to `end` (from the valuation), by category, and units by location. */
export function stockHistory(d: InventoryData, end: string, n = 12): HistoryPoint[] {
  const months = Array.from({ length: n }, (_, i) => addMonths(end, i - n + 1));
  // Valuation quantities are in each product's own unit, so they add per product; months before the first record are missing.
  const first = d.layers.reduce<string | null>((a, l) => (a === null || l.p < a ? l.p : a), null);
  return months.map((p) => {
    const byCategory: HistoryPoint["byCategory"] = {};
    let units = 0, value = 0;
    for (const l of d.layers) {
      if (l.p > p) continue;
      const c = (byCategory[l.category || "—"] ??= { units: 0, value: 0 });
      c.units += l.q; c.value += l.v; units += l.q; value += l.v;
    }
    for (const c of Object.values(byCategory)) { c.units = r4(c.units); c.value = r2(c.value); }
    const byLocation: Record<string, number> = {};
    for (const x of positionAt(d, p)) byLocation[x.loc] = x.units;
    const known = first !== null && p >= first;
    return { p, units: known ? r4(units) : null, value: known ? r2(value) : null, byCategory: known ? byCategory : {}, byLocation };
  });
}

/** Products kept in more than one unit of measure, named (their quantities are never added). */
export function mixedUnits(d: InventoryData): { count: number; text: string } | null {
  const m = d.uomMixed ?? [];
  if (!m.length) return null;
  return { count: m.length, text: `${m.length} product${m.length === 1 ? "'s moves use" : "s' moves use"} more than one unit of measure: ${m.slice(0, 5).map((x) => `${x.product || x.code} (${x.uoms.join(", ")})`).join("; ")}${m.length > 5 ? "…" : ""}. Units by location include these moves as Odoo recorded them, so they can mix units; rental leaves these products out. Stock value and the history's units (from the valuation) are not affected. Set one unit per product in Odoo, or check the conversions.` };
}

export interface RentalStatus {
  /** Per rented product: units owned at the period end, on rent, idle, the share on rent over the window, and whether
   *  more is on rent than owned (a sign the records disagree; never capped silently). */
  items: { code: string; product: string; fleet: number; onRent: number; idle: number; utilisation: number | null; over: boolean }[];
  byLocation: { loc: string; units: number }[];
  byCustomer: { partner: string; units: number }[];
  /** Σ units on rent ÷ Σ units owned over the window's month ends (a weighted average, all rented products). */
  utilisation: number | null;
}

/**
 * Rental fleet at the end of `end`: each rented product's units owned, units out on rent (rental moves out less back),
 * idle, and utilisation over the `n` month ends to `end` (month-end counts, not days). Owned is the valuation's units;
 * when rental moves carry value they took units out of the valuation, so units on rent are added back. Products whose
 * moves mix units of measure are left out.
 */
export function rentalStatus(d: InventoryData, end: string, n = 12): RentalStatus {
  const mixed = new Set((d.uomMixed ?? []).map((x) => productKey(x.code, x.product)));
  const rent = (d.rentals ?? []).filter((r) => !mixed.has(productKey(r.code, r.product)));
  if (!rent.length) return { items: [], byLocation: [], byCustomer: [], utilisation: null };
  const months = Array.from({ length: n }, (_, i) => addMonths(end, i - n + 1));
  const valued = (d.rentalValued ?? []).length > 0;
  // Each product's units by month, indexed once: owned (valuation) and out (rental moves).
  const keys = new Map<string, { code: string; product: string }>();
  const outBy = new Map<string, Map<string, number>>(), ownBy = new Map<string, Map<string, number>>();
  const add = (m: Map<string, Map<string, number>>, k: string, p: string, q: number) => { const x = m.get(k) ?? new Map<string, number>(); x.set(p, (x.get(p) ?? 0) + q); m.set(k, x); };
  for (const r of rent) { const k = productKey(r.code, r.product); keys.set(k, { code: r.code, product: r.product }); add(outBy, k, r.p, r.q); }
  for (const l of d.layers) { const k = productKey(l.code, l.product); if (keys.has(k)) add(ownBy, k, l.p, l.q); }
  const upTo = (m: Map<string, number> | undefined, p: string) => { let s = 0; for (const [q, v] of m ?? []) if (q <= p) s += v; return s; };
  let onAll = 0, fleetAll = 0;
  const items = [...keys].map(([k, x]) => {
    const at = (p: string) => { const out = upTo(outBy.get(k), p); return { out, own: upTo(ownBy.get(k), p) + (valued ? Math.max(out, 0) : 0) }; };
    let on = 0, fl = 0;
    for (const p of months) { const { out, own } = at(p); if (own > 0) { fl += own; on += Math.max(0, Math.min(out, own)); } }
    onAll += on; fleetAll += fl;
    const e = at(end), fleet = r4(e.own), onRent = r4(Math.max(0, e.out));
    return { ...x, fleet, onRent, idle: r4(Math.max(0, fleet - onRent)), utilisation: fl > 0 ? Math.round((on / fl) * 1000) / 1000 : null, over: onRent > fleet + 1e-9 };
  }).sort((a, b) => b.onRent - a.onRent);
  const sumBy = (key: "loc" | "partner") => {
    const m = new Map<string, number>();
    for (const r of rent) if (r.p <= end) m.set(r[key] || "—", (m.get(r[key] || "—") ?? 0) + r.q);
    return [...m].filter(([, q]) => Math.abs(q) > 1e-9).map(([k, q]) => [k, r4(q)] as const).sort((a, b) => b[1] - a[1]);
  };
  return {
    items,
    byLocation: sumBy("loc").map(([loc, units]) => ({ loc, units })),
    byCustomer: sumBy("partner").map(([partner, units]) => ({ partner, units })),
    utilisation: fleetAll > 0 ? Math.round((onAll / fleetAll) * 1000) / 1000 : null,
  };
}

/** How many months within the 12 to `end` hold valuation records (what the ABC classes are really measured on). */
export function abcBasisMonths(d: InventoryData, end: string): number {
  const start = addMonths(end, -11);
  return new Set(d.layers.filter((l) => l.p >= start && l.p <= end).map((l) => l.p)).size;
}

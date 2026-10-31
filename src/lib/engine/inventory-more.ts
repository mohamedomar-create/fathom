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

export interface HistoryPoint { p: string; units: number; value: number; byCategory: Record<string, { units: number; value: number }>; byLocation: Record<string, number> }

/** Units and value at each of the `n` month ends to `end` (from the valuation), by category, and units by location. */
export function stockHistory(d: InventoryData, end: string, n = 12): HistoryPoint[] {
  const months = Array.from({ length: n }, (_, i) => addMonths(end, i - n + 1));
  // Units of a product kept in more than one unit of measure can't be added: its value counts, its units don't.
  const mixed = new Set((d.uomMixed ?? []).map((x) => productKey(x.code, x.product)));
  return months.map((p) => {
    const byCategory: HistoryPoint["byCategory"] = {};
    let units = 0, value = 0;
    for (const l of d.layers) {
      if (l.p > p) continue;
      const c = (byCategory[l.category || "—"] ??= { units: 0, value: 0 });
      const q = mixed.has(productKey(l.code, l.product)) ? 0 : l.q;
      c.units += q; c.value += l.v; units += q; value += l.v;
    }
    for (const c of Object.values(byCategory)) { c.units = r4(c.units); c.value = r2(c.value); }
    const byLocation: Record<string, number> = {};
    for (const x of positionAt(d, p)) byLocation[x.loc] = x.units;
    return { p, units: r4(units), value: r2(value), byCategory, byLocation };
  });
}

/** Products kept in more than one unit of measure, named (their quantities are never added). */
export function mixedUnits(d: InventoryData): { count: number; text: string } | null {
  const m = d.uomMixed ?? [];
  if (!m.length) return null;
  return { count: m.length, text: `${m.length} product${m.length === 1 ? " is" : "s are"} recorded in more than one unit of measure, so their quantities are not added into unit totals (their value is): ${m.slice(0, 5).map((x) => `${x.product || x.code} (${x.uoms.join(", ")})`).join("; ")}${m.length > 5 ? "…" : ""}. Set one unit per product in Odoo, or check the conversions.` };
}

export interface RentalStatus {
  /** Per rented product: units owned (valued) at the period end, on rent, idle, and the share on rent over the window. */
  items: { code: string; product: string; fleet: number; onRent: number; idle: number; utilisation: number | null }[];
  byLocation: { loc: string; units: number }[];
  byCustomer: { partner: string; units: number }[];
  /** Units on rent ÷ units owned, averaged over the window's month ends (all rented products). */
  utilisation: number | null;
}

/**
 * Rental fleet at the end of `end`: each rented product's units owned (from the valuation; rented units stay the
 * company's), units out on rent (rental moves out less back), idle, and utilisation at the month ends of the `n` months
 * to `end` (month-end counts, not days).
 */
export function rentalStatus(d: InventoryData, end: string, n = 12): RentalStatus {
  const rent = d.rentals ?? [];
  if (!rent.length) return { items: [], byLocation: [], byCustomer: [], utilisation: null };
  const months = Array.from({ length: n }, (_, i) => addMonths(end, i - n + 1));
  const keys = new Map<string, { code: string; product: string }>();
  for (const r of rent) keys.set(productKey(r.code, r.product), { code: r.code, product: r.product });
  const owned = (k: string, p: string) => d.layers.reduce((s, l) => (l.p <= p && productKey(l.code, l.product) === k ? s + l.q : s), 0);
  const out = (k: string, p: string) => rent.reduce((s, r) => (r.p <= p && productKey(r.code, r.product) === k ? s + r.q : s), 0);
  let onAll = 0, fleetAll = 0;
  const items = [...keys].map(([k, x]) => {
    let on = 0, fl = 0;
    for (const p of months) { const f = owned(k, p); if (f > 0) { fl += f; on += Math.max(0, Math.min(out(k, p), f)); } }
    onAll += on; fleetAll += fl;
    const fleet = r4(owned(k, end)), onRent = r4(Math.max(0, Math.min(out(k, end), fleet)));
    return { ...x, fleet, onRent, idle: r4(Math.max(0, fleet - onRent)), utilisation: fl > 0 ? Math.round((on / fl) * 1000) / 1000 : null };
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

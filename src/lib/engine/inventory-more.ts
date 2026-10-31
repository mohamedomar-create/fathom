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
    return { p, units: r4(units), value: r2(value), byCategory, byLocation };
  });
}

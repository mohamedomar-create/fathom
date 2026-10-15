import { describe, expect, it } from "vitest";
import { parseInventorySummary } from "@/lib/company/inventory-parse";
import { EMPTY_INVENTORY } from "@/lib/engine/inventory";

describe("the Inventory summary from the database", () => {
  it("parsesSummaryAndToleratesMissingKeys", () => {
    const d = parseInventorySummary({ layers: [{ p: "2026-09", kind: "receipt", code: "P1", product: "Mask", category: "", q: "10", v: "1000", n: 1 }] });
    expect(d.layers[0]).toEqual({ p: "2026-09", kind: "receipt", code: "P1", product: "Mask", category: "", q: 10, v: 1000, n: 1 });
    expect(d.moves).toEqual([]);
    expect(d.meta).toEqual({ withIds: false, kinds: [], periods: [] });
    expect(parseInventorySummary(null)).toEqual(EMPTY_INVENTORY);
  });

  it("keeps every part the pages and tie-outs need", () => {
    const d = parseInventorySummary({
      moves: [{ p: "2026-09", kind: "rental_out", code: "D1", product: "Device", from: "WH/Stock", to: "WH/Rental", q: "1.0000", n: 1 }],
      last_out: { P1: "2026-09-05" },
      onhand: [{ asOf: "2026-09-30", product: "Mask", code: "P1", location: "WH/Stock", lot: "", qty: "6.0000", value: null }],
      products: [{ code: "P1", name: "Mask", category: "Masks", cost: "100.0000", type: "Goods" }],
      byRef: [{ p: "2026-09", ref: "WH/OUT/1", kind: "delivery", v: "-400.00" }],
      ledger: [{ p: "2026-09", ref: "WH/OUT/1", v: "-400.00" }],
      meta: { withIds: true, kinds: ["valuation", "moves"], periods: ["2026-09"] },
    });
    expect(d.moves[0]).toMatchObject({ kind: "rental_out", from: "WH/Stock", to: "WH/Rental", q: 1 });
    expect(d.lastOut).toEqual({ P1: "2026-09-05" });
    expect(d.onhand[0]).toEqual({ asOf: "2026-09-30", product: "Mask", code: "P1", location: "WH/Stock", lot: "", qty: 6, value: null });
    expect(d.products[0].cost).toBe(100);
    expect(d.byRef[0]).toEqual({ p: "2026-09", ref: "WH/OUT/1", kind: "delivery", v: -400 });
    expect(d.ledger[0]).toEqual({ p: "2026-09", ref: "WH/OUT/1", v: -400 });
    expect(d.meta).toEqual({ withIds: true, kinds: ["valuation", "moves"], periods: ["2026-09"] });
  });

  it("drops kinds it does not know rather than guessing", () => {
    const d = parseInventorySummary({ layers: [{ p: "2026-09", kind: "teleport", code: "P1", q: 1, v: 1, n: 1 }] });
    expect(d.layers[0].kind).toBe("other");
  });
});

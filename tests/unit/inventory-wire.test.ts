import { describe, expect, it } from "vitest";
import { fromWire, toWire } from "@/lib/company/inventory-wire";
import { demoInventory } from "@/lib/company/demo-inventory";
import { EMPTY_INVENTORY, EMPTY_RECORDS, inventoryAnalysis, summarizeInventory } from "@/lib/engine/inventory";

describe("the Inventory summary as the database keeps it", () => {
  it("round-trips the demo company exactly, and is far smaller than its records", () => {
    const d = demoInventory();
    const wire = JSON.parse(JSON.stringify(toWire(d)));
    expect(fromWire(wire)).toEqual(d);
    const sel = { type: "year" as const, end: d.layers.at(-1)!.p };
    expect(inventoryAnalysis(fromWire(wire), sel, 1, { ledger: { stock: null, cogs: null } })).toEqual(inventoryAnalysis(d, sel, 1, { ledger: { stock: null, cogs: null } }));
  });

  it("reads numbers sent as text and tolerates missing or broken parts", () => {
    const d = fromWire({ prods: [["P1", "Mask", "Masks"]], layers: [["2026-09", "receipt", 0, "10.5", "1000", 1], "junk"], mk: [["2026-09", "teleport", 1, 1]], onhand: [["2026-09-30", "Mask", "P1", "WH/Stock", "", "6", null]], asOf: "2026-09-30" });
    expect(d.layers).toEqual([{ p: "2026-09", kind: "receipt", code: "P1", product: "Mask", category: "Masks", q: 10.5, v: 1000, n: 1 }]);
    expect(d.moves.byKind[0].kind).toBe("internal");
    expect(d.moves.asOf).toBe("2026-09");
    expect(d.onhand[0]).toMatchObject({ qty: 6, value: null });
    expect(d.meta).toEqual({ withIds: false, kinds: [], periods: [] });
    expect(fromWire(null)).toEqual(EMPTY_INVENTORY);
    expect(fromWire({ layers: [["2026-09", "receipt", 7, 1, 1, 1]] }).layers[0]).toMatchObject({ code: "", product: "" });
  });

  it("a product's net units per location stop at the stock-on-hand month", () => {
    const mv = (p: string, q: number) => ({ p, kind: "receipt" as const, code: "P1", product: "Mask", from: "Partners/Vendors", to: "WH/Stock", q, n: 1 });
    const s = summarizeInventory({ ...EMPTY_RECORDS, moves: [mv("2026-08", 5), mv("2026-10", 3)], onhand: [{ asOf: "2026-09-30", product: "Mask", code: "P1", location: "WH/Stock", lot: "", qty: 5, value: null }] });
    expect(s.moves.asOf).toBe("2026-09");
    expect(s.moves.byProductLoc.find((x) => x.loc === "WH/Stock")!.q).toBe(5);
    expect(s.moves.months).toEqual(["2026-08", "2026-10"]);
  });
});

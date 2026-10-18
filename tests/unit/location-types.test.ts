// Which locations hold stock (fix plan 2.1, register D14/D15): Odoo's own location type when the export carries it, else the
// company's list, else the name. A repair location of type "inventory" is outside stock: units sent there leave the stock.
import { describe, expect, it } from "vitest";
import type { Grid } from "@/lib/ingest/extract";
import { locationClass, moveKind, readStockMoves } from "@/lib/ingest/inventory";
import { EMPTY_RECORDS, inventoryAnalysis, summarizeInventory, type LayerRow, type MoveRow } from "@/lib/engine/inventory";

const grid = (rows: (string | number | null)[][]): Grid => ({ name: "Sheet1", rows });

describe("location types", () => {
  it("a repair location is outside stock by its name; the company's list and Odoo's type win over the name", () => {
    expect(locationClass("Repair & Maintenance")).toBe("virtual");
    expect(locationClass("صيانة")).toBe("virtual");
    // Inside a warehouse, a maintenance location is the company's stock.
    expect(locationClass("MAINT/Maintenance")).toBe("warehouse");
    expect(locationClass("Repair & Maintenance", [], { "Repair & Maintenance": "internal" })).toBe("warehouse");
    expect(locationClass("WH/Quarantine", [], { "WH/Quarantine": "outside" })).toBe("virtual");
    expect(locationClass("Cairo/Fleet", [], { "Cairo/Fleet": "rental" })).toBe("rental_out");
    expect(locationClass("Cairo/On the road", [], { "Cairo/On the road": "transit" })).toBe("transit");
    expect(moveKind("WH/Stock", "Repair & Maintenance", [])).toBe("adjustment");
    expect(moveKind("WH/Stock", "WH/Quarantine", [], { "WH/Quarantine": "outside" })).toBe("adjustment");
  });

  it("reads Odoo's source and destination location types from the moves export and returns them", () => {
    const r = readStockMoves(grid([
      ["Date", "Product", "From", "Source Location Type", "To", "Destination Location Type", "Quantity", "Reference", "Status"],
      ["2026-09-01", "[P1] Mask", "Partner Locations/Vendors", "Vendor Location", "WH/Stock", "Internal Location", 5, "WH/IN/1", "done"],
      ["2026-09-02", "[P1] Mask", "WH/Stock", "Internal Location", "WH/Workshop", "Inventory Loss", 2, "WH/INT/1", "done"],
    ]))!;
    expect(r.moves.map((m) => m.kind)).toEqual(["receipt", "adjustment"]);
    expect(r.locationTypes).toEqual({ "WH/Stock": "internal", "WH/Workshop": "outside" });
  });

  it("units sent to a location outside stock leave the units held, so they agree with the valuation", () => {
    const L: LayerRow[] = [{ p: "2026-09", kind: "receipt", code: "P1", product: "Mask", category: "", q: 5, v: 500, n: 1 }, { p: "2026-09", kind: "adjustment", code: "P1", product: "Mask", category: "", q: -2, v: -200, n: 1 }];
    const M: MoveRow[] = [{ p: "2026-09", kind: "receipt", code: "P1", product: "Mask", from: "Partner Locations/Vendors", to: "WH/Stock", q: 5, n: 1 }, { p: "2026-09", kind: "internal", code: "P1", product: "Mask", from: "WH/Stock", to: "WH/Workshop", q: 2, n: 1 }];
    const d = summarizeInventory({ ...EMPTY_RECORDS, layers: L, moves: M, meta: { withIds: false, kinds: ["valuation", "moves"], periods: ["2026-09"] } });
    const at = (types?: Record<string, "internal" | "outside">) => inventoryAnalysis({ ...d, moves: { ...d.moves, types } }, { type: "month", end: "2026-09" }, 1, { ledger: { stock: null, cogs: null } }).tieouts.find((t) => t.key === "qty_valued");
    expect(at()).toMatchObject({ status: "off", module: 3, ledger: 5 });
    expect(at({ "WH/Workshop": "outside" })).toMatchObject({ status: "ok", module: 3, ledger: 3 });
  });
});

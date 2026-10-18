import { describe, expect, it } from "vitest";
import type { Grid } from "@/lib/ingest/extract";
import { classifyLayers, locationClass, productKey, readStockMoves, readStockOnHand, readStockValuation } from "@/lib/ingest/inventory";
import { guessRole } from "@/lib/ingest/roles";
import { EMPTY_RECORDS, summarizeInventory, inventoryAnalysis, tieSummary, type InventoryData, type LayerRow, type MoveRow } from "@/lib/engine/inventory";

/**
 * Made-up exports shaped exactly like a real Odoo 18 company's (the repository is public): the internal reference holds a
 * product group ("[Device]"), adjustments are "INV:…", a receipt carries a zero-quantity landed cost, a return to a supplier
 * goes out on an OUT document, the rental fleet sits in a warehouse ("Cai/Rental/…") and devices out with customers sit in
 * "Virtual Locations/Rental", and the Product Variant list gives what is on hand in the warehouses with its value.
 */
const grid = (name: string, rows: (string | number | null)[][]): Grid => ({ name, rows });
const VAL = grid("Sheet1", [
  ["Created on", "Product", "Quantity", "Reference", "Total Value"],
  ["2026-07-02 10:00:00", "[Device] Alpha Concentrator", 3, "New C/IN/00001", 300],
  ["2026-07-02 10:05:00", "[Device] Alpha Concentrator", 0, "New C/IN/00001", 30],
  ["2026-07-03 09:00:00", "[Device] Beta Ventilator", 2, "New C/IN/00002", 1000],
  ["2026-07-05 12:00:00", "[Device] Beta Ventilator", 1, "INV:Cairo Adj", 500],
  ["2026-08-03 11:00:00", "[Device] Alpha Concentrator", -1, "Cai/R/OUT/00001", -110],
  ["2026-08-20 15:00:00", "[Device] Beta Ventilator", -1, "New C/OUT/00009", -500],
]);
const MOVES = grid("Sheet1", [
  ["Date", "From", "Lot/Serial Number", "Product", "Quantity", "Reference", "Status", "To", "Unit of Measure"],
  ["2026-07-02 10:00:00", "Partner Locations/Vendors", "A1", "[Device] Alpha Concentrator", 3, "New C/IN/00001", "done", "Cairo/NEW Cairo", "PCS"],
  ["2026-07-03 09:00:00", "Partner Locations/Vendors", "B1", "[Device] Beta Ventilator", 2, "New C/IN/00002", "done", "Cairo/NEW Cairo", "PCS"],
  ["2026-07-05 12:00:00", "Virtual Locations/My Company: Inventory adjustment", "B2", "[Device] Beta Ventilator", 1, "INV:Cairo Adj", "done", "Cairo/NEW Cairo", "PCS"],
  ["2026-07-10 08:00:00", "Cairo/NEW Cairo", "A1", "[Device] Alpha Concentrator", 2, "cairo/INT/00001", "done", "Cai/Rental/Cairo rental", "PCS"],
  ["2026-07-12 08:00:00", "Cai/Rental/Cairo rental", "A1", "[Device] Alpha Concentrator", 1, "Cai/Rental/PICK/00001", "done", "Virtual Locations/Rental", "PCS"],
  ["2026-08-01 08:00:00", "Cairo/NEW Cairo", "B1", "[Device] Beta Ventilator", 1, "cairo/INT/00002", "done", "Physical Locations/Alexandria Transit", "PCS"],
  ["2026-08-03 11:00:00", "Cai/Rental/Cairo rental", "A1", "[Device] Alpha Concentrator", 1, "Cai/R/OUT/00001", "done", "Partner Locations/Customers", "PCS"],
  ["2026-08-20 15:00:00", "Cairo/NEW Cairo", "B2", "[Device] Beta Ventilator", 1, "New C/OUT/00009", "done", "Partner Locations/Vendors", "PCS"],
  ["2026-08-21 15:00:00", "Cairo/NEW Cairo", "B2", "[Device] Beta Ventilator", 1, "New C/OUT/00010", "cancel", "Partner Locations/Customers", "PCS"],
]);
const VARIANT = grid("Sheet1", [
  ["Average Cost", "Display Name", "Free To Use Quantity", "Incoming", "Outgoing", "Quantity On Hand", "Total Value", "Unit of Measure"],
  // Odoo's Total Value is the product's whole valuation: the unit out on rental (Alpha) and in transit (Beta) included.
  [110, "[Device] Alpha Concentrator", 1, 0, 0, 1, 220, "PCS"],
  [500, "[Device] Beta Ventilator", 1, 0, 0, 1, 1000, "PCS"],
  [0, "[Device] Gamma Mask", 0, 0, 0, 0, 0, "PCS"],
]);

/** The rows the database summary would hold for these exports (one per product, month, kind and route). */
function summary(): InventoryData {
  const v = readStockValuation(VAL)!, m = readStockMoves(MOVES)!;
  const layers = classifyLayers(v.layers, m.moves);
  const L: LayerRow[] = layers.map((l) => ({ p: l.period, kind: l.kind, code: l.code, product: l.product, category: "", q: l.qty, v: l.value, n: 1 }));
  const M: MoveRow[] = m.moves.map((x) => ({ p: x.period, kind: x.kind, code: x.code, product: x.product, from: x.from, to: x.to, q: x.qty, n: 1 }));
  const onhand = readStockOnHand(VARIANT, "2026-08-31")!;
  return summarizeInventory({ ...EMPTY_RECORDS, layers: L, moves: M, onhand, byRef: layers.map((l) => ({ p: l.period, ref: l.ref, kind: l.kind, v: l.value })), meta: { withIds: false, kinds: ["valuation", "moves", "onhand"], periods: ["2026-07", "2026-08"] } });
}

describe("Odoo 18 exports as a real company makes them", () => {
  it("keeps products apart when the internal reference is a group shared by many products", () => {
    const v = readStockValuation(VAL)!;
    expect(new Set(v.layers.map((l) => productKey(l.code, l.product)))).toEqual(new Set(["[Device] Alpha Concentrator", "[Device] Beta Ventilator"]));
    const a = inventoryAnalysis(summary(), { type: "year", end: "2026-08" }, 1, { ledger: { stock: null, cogs: null } });
    expect(a.products.map((p) => p.product).sort()).toEqual(["Alpha Concentrator", "Beta Ventilator"]);
    expect(a.products.find((p) => p.product === "Beta Ventilator")).toMatchObject({ value: 1000, qty: 2 });
  });

  it("tells the rental fleet's warehouse from devices out with customers, and transit from warehouses", () => {
    expect(locationClass("Cai/Rental/Cairo rental", ["Virtual Locations/Rental"])).toBe("warehouse");
    expect(locationClass("Virtual Locations/Rental", ["Virtual Locations/Rental"])).toBe("rental_out");
    expect(locationClass("Physical Locations/Alexandria Transit", [])).toBe("transit");
    expect(locationClass("Virtual Locations/My Company: Inventory adjustment", [])).toBe("virtual");
    expect(locationClass("Partner Locations/Customers", [])).toBe("partner");
    const kinds = readStockMoves(MOVES)!.moves.map((x) => [x.ref, x.kind]);
    expect(kinds).toEqual([
      ["New C/IN/00001", "receipt"], ["New C/IN/00002", "receipt"], ["INV:Cairo Adj", "adjustment"], ["cairo/INT/00001", "internal"],
      ["Cai/Rental/PICK/00001", "rental_out"], ["cairo/INT/00002", "internal"], ["Cai/R/OUT/00001", "delivery"], ["New C/OUT/00009", "supplier_return"],
    ]);
  });

  it("classifies each valuation row from its move, and a zero-quantity value on a receipt as a landed cost", () => {
    const v = readStockValuation(VAL)!, m = readStockMoves(MOVES)!;
    expect(classifyLayers(v.layers, m.moves).map((l) => [l.ref, l.kind])).toEqual([
      ["New C/IN/00001", "receipt"], ["New C/IN/00001", "landed_cost"], ["New C/IN/00002", "receipt"], ["INV:Cairo Adj", "adjustment"],
      ["Cai/R/OUT/00001", "delivery"], ["New C/OUT/00009", "supplier_return"],
    ]);
    // Without the moves, an "INV:" reference is still an inventory adjustment.
    expect(v.layers.find((l) => l.ref === "INV:Cairo Adj")!.kind).toBe("adjustment");
  });

  it("puts a back-dated row in the month Odoo accounted it in ([Accounted on …] in its reference)", () => {
    const g = grid("Sheet1", [["Created on", "Product", "Quantity", "Reference", "Total Value"],
      ["2026-02-03 10:00:00", "[Device] Beta Ventilator", 1, "Product Quantity Updated [Accounted on 2026-01-17]", 500],
      ["2026-02-04 10:00:00", "[Device] Beta Ventilator", 1, "New C/IN/00003", 500]]);
    expect(readStockValuation(g)!.layers.map((l) => [l.day, l.period])).toEqual([["2026-01-17", "2026-01"], ["2026-02-04", "2026-02"]]);
  });

  it("reads Odoo's Product Variant list as stock on hand in the warehouses, with its value", () => {
    expect(guessRole(VARIANT)).toMatchObject({ role: "stock_onhand", sure: true });
    expect(readStockOnHand(VARIANT, "2026-08-31")!.map((o) => [productKey(o.code, o.product), o.location, o.qty, o.value])).toEqual([
      ["[Device] Alpha Concentrator", "", 1, 220], ["[Device] Beta Ventilator", "", 1, 1000], ["[Device] Gamma Mask", "", 0, 0],
    ]);
  });

  it("reconciles the valuation with what is in the warehouses, out on rental and in transit, unit by unit and pound by pound", () => {
    const a = inventoryAnalysis(summary(), { type: "month", end: "2026-08" }, 1, { ledger: { stock: null, cogs: null } });
    const t = (k: string) => a.tieouts.find((x) => x.key === k)!;
    expect(t("qty_onhand")).toMatchObject({ status: "ok", module: 2, ledger: 2 });
    expect(t("qty_valued")).toMatchObject({ status: "ok", module: 4, ledger: 4 });
    expect(t("onhand_value")).toMatchObject({ status: "ok", module: 1220, ledger: 1220 });
    expect(a.position).toEqual({ warehouse: 610, rental: 110, transit: 500, at: "2026-08" });
    // These are checks inside Inventory: they never read as "agree with the accounts".
    expect(tieSummary(a.tieouts).checked).toBe(0);
  });

  it("a stock list by location values the warehouses only, so rental and transit are added to it, once", () => {
    const d = summary();
    d.onhand = [{ asOf: "2026-08-31", product: "Alpha Concentrator", code: "Device", location: "WH/Stock", lot: "", qty: 1, value: 110 }, { asOf: "2026-08-31", product: "Beta Ventilator", code: "Device", location: "WH/Stock", lot: "", qty: 1, value: 500 }];
    const a = inventoryAnalysis(d, { type: "month", end: "2026-08" }, 1, { ledger: { stock: null, cogs: null } });
    expect(a.tieouts.find((x) => x.key === "onhand_value")).toMatchObject({ status: "ok", module: 1220, ledger: 1220 });
  });

  it("names the products whose units Odoo moved but never valued (a receipt posted without value)", () => {
    const d = summary();
    d.layers = d.layers.map((l) => (l.kind === "receipt" && l.product === "Beta Ventilator" ? { ...l, q: 0 } : l));
    const a = inventoryAnalysis(d, { type: "month", end: "2026-08" }, 1, { ledger: { stock: null, cogs: null } });
    const off = a.tieouts.find((x) => x.key === "qty_valued")!;
    expect(off.status).toBe("off");
    expect(off.causes[0]).toMatchObject({ ref: "[Device] Beta Ventilator", module: 0, ledger: 2 });
    // A disagreement between Odoo's own exports is a note to check in Odoo, never "differs from the accounts".
    const f = a.findings.find((x) => /valuation and its moves/i.test(x.title))!;
    expect(f).toMatchObject({ kind: "watch" });
    expect(f.text).toMatch(/\[Device\] Beta Ventilator/);
    expect(a.findings.some((x) => /accounts/i.test(x.title))).toBe(false);
  });
});

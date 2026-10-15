import { describe, expect, it } from "vitest";
import type { Grid } from "@/lib/ingest/extract";
import { layerKind, moveKind, readProducts, readStockMoves, readStockOnHand, readStockValuation } from "@/lib/ingest/inventory";

// Made-up products and references only (the repo is public).
const grid = (name: string, rows: (string | number | null)[][]): Grid => ({ name, rows });

const VAL_HEAD = ["ID", "Date", "Reference", "Product", "Lot/Serial Number", "Quantity", "Unit Value", "Total Value", "Description"];
const VAL_ROWS = [
  ["__export__.svl_1", "2026-09-02 10:00:00", "WH/IN/00001", "[P1] Mask", "", 10, 100, 1000, ""],
  ["__export__.svl_2", "2026-09-05 12:30:00", "WH/OUT/00001", "[P1] Mask", "", -4, 100, -400, ""],
  ["__export__.svl_3", "2026-09-06 09:00:00", "LC/2026/0001", "[P1] Mask", "", 0, 0, 120, "Landed cost LC/2026/0001"],
];

describe("Odoo stock valuation sheet", () => {
  it("readsValuationWithIds", () => {
    const r = readStockValuation(grid("Valuation", [VAL_HEAD, ...VAL_ROWS]))!;
    expect(r.withIds).toBe(true);
    expect(r.layers.map((l) => l.key)).toEqual(["__export__.svl_1", "__export__.svl_2", "__export__.svl_3"]);
    expect(r.layers.map((l) => l.kind)).toEqual(["receipt", "delivery", "landed_cost"]);
    expect(r.layers.map((l) => l.value)).toEqual([1000, -400, 120]);
    expect(r.layers[0]).toMatchObject({ code: "P1", product: "Mask", period: "2026-09", day: "2026-09-02", ref: "WH/IN/00001", qty: 10, unitValue: 100 });
    expect(r.layers[2].landedRef).toBe("LC/2026/0001");
  });

  it("fingerprintsWithoutIds", () => {
    const head = VAL_HEAD.slice(1), rows = VAL_ROWS.map((x) => x.slice(1));
    const r = readStockValuation(grid("Valuation", [head, ...rows, rows[0]]))!;
    expect(r.withIds).toBe(false);
    expect(r.layers.every((l) => l.key.startsWith("fp:"))).toBe(true);
    // The same row read twice gets the same key, so the database refuses the second copy.
    expect(r.layers[3].key).toBe(r.layers[0].key);
    expect(new Set(r.layers.slice(0, 3).map((l) => l.key)).size).toBe(3);
  });

  it("reads Odoo's technical field names (import-compatible export)", () => {
    const head = ["id", "create_date", "reference", "product_id", "quantity", "unit_cost", "value", "description"];
    const r = readStockValuation(grid("svl", [head, ["__export__.svl_9", "2026-08-01", "WH/IN/00009", "[P2] Tube", 5, 20, 100, ""]]))!;
    expect(r.layers[0]).toMatchObject({ key: "__export__.svl_9", code: "P2", product: "Tube", value: 100, kind: "receipt" });
  });
});

describe("move and layer kinds", () => {
  it("classifiesMovesByLocation", () => {
    expect(moveKind("Partners/Vendors", "WH/Stock")).toBe("receipt");
    expect(moveKind("WH/Stock", "Partners/Customers")).toBe("delivery");
    expect(moveKind("Partners/Customers", "WH/Stock")).toBe("customer_return");
    expect(moveKind("WH/Stock", "Partners/Vendors")).toBe("supplier_return");
    expect(moveKind("WH/Stock", "Virtual Locations/Inventory adjustment")).toBe("adjustment");
    expect(moveKind("WH/Stock", "Virtual Locations/Scrap")).toBe("scrap");
    expect(moveKind("WH/Stock", "WH/Rental")).toBe("rental_out");
    expect(moveKind("WH/Rental", "WH/Stock")).toBe("rental_back");
    expect(moveKind("WH/Stock", "WH/Shelf 2")).toBe("internal");
    // A rental location picked by the person, whatever its name.
    expect(moveKind("WH/Stock", "WH/Hire Pool", "WH/Hire Pool")).toBe("rental_out");
  });

  it("names layers from the reference when no move is loaded", () => {
    expect(layerKind("WH/IN/00002", "", 3)).toBe("receipt");
    expect(layerKind("WH/IN/00002", "", -3)).toBe("supplier_return");
    expect(layerKind("WH/OUT/00002", "", -3)).toBe("delivery");
    expect(layerKind("WH/OUT/00002", "", 3)).toBe("customer_return");
    expect(layerKind("LC/2026/0002", "", 0)).toBe("landed_cost");
    expect(layerKind("", "Product Quantity Updated", 2)).toBe("adjustment");
    expect(layerKind("WH/OUT/00003", "", -1, "rental_out")).toBe("other");
    expect(layerKind("WH/INT/00003", "", -1, "scrap")).toBe("scrap");
  });
});

describe("Odoo moves history sheet", () => {
  it("reads done moves only, with their kind", () => {
    const head = ["ID", "Date", "Reference", "Product", "Lot/Serial Number", "From", "To", "Quantity", "Status"];
    const r = readStockMoves(grid("Moves", [head,
      ["__export__.sml_1", "2026-09-02", "WH/IN/00001", "[P1] Mask", "L1", "Partners/Vendors", "WH/Stock", 10, "Done"],
      ["__export__.sml_2", "2026-09-05", "WH/OUT/00001", "[P1] Mask", "L1", "WH/Stock", "Partners/Customers", 4, "Done"],
      ["__export__.sml_3", "2026-09-07", "WH/OUT/00002", "[P1] Mask", "L1", "WH/Stock", "Partners/Customers", 2, "Cancelled"],
    ]))!;
    expect(r.withIds).toBe(true);
    expect(r.moves.map((m) => [m.key, m.kind, m.qty, m.lot])).toEqual([["__export__.sml_1", "receipt", 10, "L1"], ["__export__.sml_2", "delivery", 4, "L1"]]);
  });

  it("readsArabicHeadingsAndRentalLocation", () => {
    const head = ["المعرف", "التاريخ", "المرجع", "المنتج", "من", "إلى", "الكمية", "الحالة"];
    const r = readStockMoves(grid("الحركات", [head, ["__export__.sml_7", "2026-09-10", "WH/INT/00007", "[D1] جهاز", "WH/Stock", "WH/مخزن التأجير", 1, "منتهي"]]))!;
    expect(r.moves[0]).toMatchObject({ kind: "rental_out", code: "D1", product: "جهاز", qty: 1, period: "2026-09" });
  });
});

describe("Odoo stock on hand and products sheets", () => {
  it("readsOnHandSnapshot", () => {
    const r = readStockOnHand(grid("Stock", [["Location", "Product", "Lot/Serial Number", "On Hand Quantity", "Value"], ["WH/Stock", "[P1] Mask", "L1", 6, 600]]), "2026-09-30")!;
    expect(r).toEqual([{ asOf: "2026-09-30", product: "Mask", code: "P1", location: "WH/Stock", lot: "L1", qty: 6, value: 600 }]);
  });

  it("reads the products list", () => {
    const r = readProducts(grid("Products", [["Internal Reference", "Name", "Product Category", "Cost", "Product Type"], ["P1", "Mask", "All / Consumables", 100, "Goods"]]))!;
    expect(r).toEqual([{ code: "P1", name: "Mask", category: "All / Consumables", cost: 100, type: "Goods" }]);
  });

  it("rejectsOtherSheets", () => {
    const sales = grid("Sales", [["Date", "Customer", "Product", "Untaxed Total"], ["2026-09-01", "Client A", "Mask", 500]]);
    expect(readStockValuation(sales)).toBeNull();
    expect(readStockMoves(sales)).toBeNull();
    expect(readStockOnHand(sales, "2026-09-30")).toBeNull();
    expect(readProducts(sales)).toBeNull();
    // A valuation list is not a moves list, and the other way round.
    expect(readStockMoves(grid("Valuation", [VAL_HEAD, ...VAL_ROWS]))).toBeNull();
  });
});

describe("stock postings from the General Ledger", async () => {
  const { stockFromLedger } = await import("@/lib/ingest/inventory");
  const e = (day: string, ref: string, amount: number) => ({ day, period: day.slice(0, 7), ref, label: ref, partner: "", amount });

  it("stockLedgerKeepsInventoryAccountsOnly", () => {
    const lines = stockFromLedger([
      { code: "110500", name: "Stock Valuation", cls: "inventory", excluded: false, entries: [e("2026-09-02", "WH/IN/00001", 1000), e("2026-09-05", "WH/OUT/00001", -400), e("2026-09-06", "LC/2026/0001", 120)] },
      { code: "522006", name: "Office Rent", cls: "exp_fixed", excluded: false, entries: [e("2026-09-02", "BILL/2026/0001", 500)] },
      { code: "110600", name: "Old Stock", cls: "inventory", excluded: true, entries: [e("2026-09-02", "WH/IN/00002", 50)] },
    ]);
    expect(lines).toEqual([
      { day: "2026-09-02", period: "2026-09", ref: "WH/IN/00001", account: "110500 Stock Valuation", amount: 1000 },
      { day: "2026-09-05", period: "2026-09", ref: "WH/OUT/00001", account: "110500 Stock Valuation", amount: -400 },
      { day: "2026-09-06", period: "2026-09", ref: "LC/2026/0001", account: "110500 Stock Valuation", amount: 120 },
    ]);
  });
});

describe("company locations", async () => {
  const { isInternalLocation } = await import("@/lib/ingest/inventory");
  it("tells the company's own locations from partner and virtual ones", () => {
    expect(isInternalLocation("WH/Stock")).toBe(true);
    expect(isInternalLocation("WH/Rental")).toBe(true);
    expect(isInternalLocation("Partners/Vendors")).toBe(false);
    expect(isInternalLocation("Partners/Customers")).toBe(false);
    expect(isInternalLocation("Virtual Locations/Inventory adjustment")).toBe(false);
    expect(isInternalLocation("Virtual Locations/Scrap")).toBe(false);
    expect(isInternalLocation("Virtual Locations/Production")).toBe(false);
  });
});

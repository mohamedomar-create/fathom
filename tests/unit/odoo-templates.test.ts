import { describe, expect, it } from "vitest";
import type { Grid } from "@/lib/ingest/extract";
import { describeColumns, mapColumns } from "@/lib/ingest/odoo-templates";
import { parseStamp, readOnHandSheet, readStockMoves, readStockValuation } from "@/lib/ingest/inventory";
import { guessRole } from "@/lib/ingest/roles";

const grid = (rows: (string | number | Date | null)[][], origin?: { r: number; c: number }): Grid => ({ name: "Sheet1", rows, ...(origin ? { origin } : {}) });

describe("Odoo export templates", () => {
  it("maps Odoo's headings (labels, technical names, Arabic) to fields, the company's own choices first", () => {
    expect(mapColumns(["ID", "Last Updated on", "Date", "Product", "Quantity", "Total Value", "Reference"])).toEqual({ id: 0, updated: 1, date: 2, product: 3, qty: 4, value: 5, ref: 6 });
    expect(mapColumns(["id", "write_date", "create_date", "product_id", "quantity", "value", "stock_move_id"])).toMatchObject({ id: 0, updated: 1, date: 2, product: 3, qty: 4, value: 5, ref: 6 });
    expect(mapColumns(["التاريخ", "المنتج", "الكمية", "القيمة الإجمالية", "المرجع"])).toEqual({ date: 0, product: 1, qty: 2, value: 3, ref: 4 });
    // A heading Odoo never uses, pointed at a field by the company; the built-in match for that field no longer wins.
    expect(mapColumns(["Date", "Product", "Qty", "Valeur", "Total Value", "Reference"], { value: "Valeur" })).toMatchObject({ value: 3, qty: 2 });
  });

  it("says which required columns an export is missing", () => {
    const d = describeColumns(grid([["Date", "Product", "Quantity", "Reference"]]), "stock.valuation.layer");
    expect(d.missing).toEqual(["Total value"]);
    expect(d.fields.find((f) => f.field === "id")).toMatchObject({ col: null });
    expect(describeColumns(grid([["Date", "Product", "Quantity", "Total Value", "Description"]]), "stock.valuation.layer").missing).toEqual([]);
  });
});

describe("readers never drop or zero a row silently", () => {
  const head = ["ID", "Last Updated on", "Date", "Product", "Quantity", "Total Value", "Reference"];

  it("reports a row whose number is text or whose date is unreadable, with its row in the sheet", () => {
    const r = readStockValuation(grid([
      head,
      ["svl_1", "2026-08-03 10:00:00", "2026-08-03", "[P1] Mask", 10, 1000, "WH/IN/00001"],
      ["svl_2", "", "2026-08-04", "[P1] Mask", "abc", 50, "WH/IN/00002"],
      ["svl_3", "", "someday", "[P1] Mask", 1, 100, "WH/IN/00003"],
      [null, null, null, null, 11, 1100, null],
      ["svl_4", "", "2026-08-05", "", 1, 100, "WH/IN/00004"],
    ], { r: 4, c: 0 }))!;
    expect(r.layers.map((l) => [l.key, l.updated])).toEqual([["svl_1", "2026-08-03 10:00:00"]]);
    // Sheet rows: the heading is on row 5 (the used range starts at row 5), so data starts on row 6.
    expect(r.issues).toEqual([
      { line: 7, message: 'Quantity is not a number: "abc"' },
      { line: 8, message: 'Date is not readable: "someday"' },
      { line: 10, message: "No product" },
    ]);
    // A line with neither date nor product (a total) is not a record.
    expect(r.skipped).toBe(1);
  });

  it("reads Odoo's last-updated date from text or a date cell, and refuses one it cannot read", () => {
    expect(parseStamp("2026-08-03 10:00:00")).toBe("2026-08-03 10:00:00");
    expect(parseStamp("2026-08-03")).toBe("2026-08-03 00:00:00");
    expect(parseStamp(new Date(2026, 7, 3, 9, 5, 7))).toBe("2026-08-03 09:05:07");
    expect(parseStamp("")).toBe("");
    expect(parseStamp("yesterday")).toBeNull();
  });

  it("leaves out moves that are not done, and reports a move with no location", () => {
    const r = readStockMoves(grid([
      ["Date", "Product", "From", "To", "Quantity", "Reference", "Status"],
      ["2026-08-03", "Mask", "Partner Locations/Vendors", "WH/Stock", 10, "WH/IN/1", "done"],
      ["2026-08-04", "Mask", "WH/Stock", "Partner Locations/Customers", 2, "WH/OUT/1", "cancel"],
      ["2026-08-05", "Mask", "WH/Stock", "", 2, "WH/OUT/2", "done"],
    ]))!;
    expect(r.moves.map((m) => m.ref)).toEqual(["WH/IN/1"]);
    expect(r.skipped).toBe(1);
    expect(r.issues).toEqual([{ line: 4, message: "No source or destination location" }]);
  });

  it("reports a stock-on-hand row whose quantity is text", () => {
    const r = readOnHandSheet(grid([["Product", "Quantity On Hand", "Total Value"], ["Mask", 5, 500], ["Gown", "n/a", 0]]), "2026-10-15")!;
    expect(r.rows.map((x) => x.product)).toEqual(["Mask"]);
    expect(r.issues).toEqual([{ line: 3, message: 'Quantity is not a number: "n/a"' }]);
  });
});

describe("Odoo's product variant list in another layout (Name and Internal Reference, no Total Value)", () => {
  // Today's export from a company's Odoo: the name and the internal reference in two columns, "Cost" instead of a value.
  const variants = grid([
    ["Cost", "Favorite", "Forecasted Quantity", "Internal Reference", "Name", "Quantity On Hand", "Sales Price", "Unit of Measure", "Variant Values"],
    [5691.08, "False", 0, "Accessories", "Air mattress Compressor", 0, 0, "PCS", null],
    [4041.19, "False", 3, "Device", "Airtech AE-5 10L/min", 3, 0, "PCS", null],
    [12.5, "False", 0, null, "YUWELL FILTER", -2, 0, "PCS", null],
  ]);

  it("is read as stock on hand, each product named as in the valuation and moves (\"[reference] name\")", () => {
    const r = readOnHandSheet(variants, "2026-10-15")!;
    expect(r.issues).toEqual([]);
    expect(r.rows.map((o) => [o.code, o.product, o.qty])).toEqual([["Accessories", "Air mattress Compressor", 0], ["Device", "Airtech AE-5 10L/min", 3], ["", "YUWELL FILTER", -2]]);
  });

  it("never takes Cost × quantity as the stock value: without Total Value the value is left to the valuation layers", () => {
    expect(readOnHandSheet(variants, "2026-10-15")!.rows.every((o) => o.value === null)).toBe(true);
  });

  it("is recognised as Odoo's product variants (stock on hand), never as the products list", () => {
    expect(guessRole(variants).role).toBe("stock_onhand");
  });
});

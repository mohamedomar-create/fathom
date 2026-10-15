import { describe, expect, it } from "vitest";
import type { Grid } from "@/lib/ingest/extract";
import { guessRole, IMPORTED } from "@/lib/ingest/roles";

const grid = (name: string, rows: (string | number | null)[][]): Grid => ({ name, rows });

describe("Inventory sheets are recognised and routed to Inventory only", () => {
  const valuation = grid("Valuation", [
    ["ID", "Date", "Reference", "Product", "Quantity", "Unit Value", "Total Value"],
    ["__export__.svl_1", "2026-09-02", "WH/IN/00001", "[P1] Mask", 10, 100, 1000],
    ["__export__.svl_2", "2026-09-05", "WH/OUT/00001", "[P1] Mask", -4, 100, -400],
    ["__export__.svl_3", "2026-09-06", "WH/IN/00002", "[P2] Tube", 5, 20, 100],
  ]);
  const moves = grid("Moves", [
    ["ID", "Date", "Reference", "Product", "From", "To", "Quantity", "Status"],
    ["__export__.sml_1", "2026-09-02", "WH/IN/00001", "[P1] Mask", "Partners/Vendors", "WH/Stock", 10, "Done"],
    ["__export__.sml_2", "2026-09-05", "WH/OUT/00001", "[P1] Mask", "WH/Stock", "Partners/Customers", 4, "Done"],
    ["__export__.sml_3", "2026-09-06", "WH/IN/00002", "[P2] Tube", "Partners/Vendors", "WH/Stock", 5, "Done"],
  ]);
  const onhand = grid("Stock", [["Location", "Product", "On Hand Quantity", "Value"], ["WH/Stock", "[P1] Mask", 6, 600], ["WH/Stock", "[P2] Tube", 5, 100]]);
  const products = grid("Products", [["Internal Reference", "Name", "Product Category", "Cost"], ["P1", "Mask", "Masks", 100], ["P2", "Tube", "Tubes", 20], ["P3", "Valve", "Parts", 5]]);

  it("routesInventorySheets", () => {
    expect(guessRole(valuation)).toMatchObject({ role: "stock_valuation", sure: true });
    expect(guessRole(moves)).toMatchObject({ role: "stock_moves", sure: true });
    expect(guessRole(onhand)).toMatchObject({ role: "stock_onhand", sure: true });
    // A products list could be a price list with a category column: the person confirms it.
    expect(guessRole(products)).toMatchObject({ role: "products", sure: false });
    for (const r of ["stock_valuation", "stock_moves", "stock_onhand", "products"] as const) expect(IMPORTED.has(r)).toBe(true);
  });

  it("leaves sales and bills lists where they were", () => {
    const sales = grid("Sales", [["Date", "Customer", "Product", "Untaxed Total"], ["2026-09-01", "Client A", "Mask", 500], ["2026-09-02", "Client B", "Tube", 300], ["2026-09-03", "Client C", "Valve", 200]]);
    const bills = grid("Bills", [["Date", "Vendor", "Bill Number", "Untaxed Amount"], ["2026-09-01", "Supplier A", "BILL/2026/0001", 500], ["2026-09-02", "Supplier B", "BILL/2026/0002", 300], ["2026-09-03", "Supplier C", "BILL/2026/0003", 200]]);
    expect(guessRole(sales).role).toBe("sales");
    expect(guessRole(bills).role).toBe("bills");
  });

  it("keeps an invoice analysis with a product category column as bills, not products", () => {
    // The headings of Odoo's Invoice Analysis of vendor bills (tests/fixtures/files/odoo-vendor-bills.xlsx).
    const analysis = grid("Invoice Analysis", [
      ["Invoice Date", "Number", "Vendor", "Product", "Product Category", "Account", "Untaxed Total"],
      ["05/01/2026", "BILL/2026/0001", "Supplier A", "Full Face Mask (box)", "Consumables", "500100 Cost of Goods Sold", -24000],
      ["07/01/2026", "BILL/2026/0002", "Landlord", "Office rent January", "Services", "620200 Office Rent", -18000],
      ["09/01/2026", "BILL/2026/0003", "Supplier B", "Tube", "Consumables", "500100 Cost of Goods Sold", -3000],
    ]);
    expect(guessRole(analysis).role).toBe("bills");
  });
});

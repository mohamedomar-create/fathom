import ExcelJS from "exceljs";

/** A made-up two-sheet Odoo Inventory export (valuation and moves history), as an import-compatible export: 3 layers, 4 done moves. */
export async function stockWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Valuation").addRows([
    ["ID", "Date", "Reference", "Product", "Quantity", "Unit Value", "Total Value"],
    ["__export__.svl_1", "2026-09-02", "WH/IN/00001", "[P1] Mask", 10, 100, 1000],
    ["__export__.svl_2", "2026-09-05", "WH/OUT/00001", "[P1] Mask", -4, 100, -400],
    ["__export__.svl_3", "2026-09-06", "WH/IN/00002", "[P2] Tube", 5, 20, 100],
  ]);
  wb.addWorksheet("Moves").addRows([
    ["ID", "Date", "Reference", "Product", "From", "To", "Quantity", "Status"],
    ["__export__.sml_1", "2026-09-02", "WH/IN/00001", "[P1] Mask", "Partners/Vendors", "WH/Stock", 10, "Done"],
    ["__export__.sml_2", "2026-09-05", "WH/OUT/00001", "[P1] Mask", "WH/Stock", "Partners/Customers", 4, "Done"],
    ["__export__.sml_3", "2026-09-06", "WH/IN/00002", "[P2] Tube", "Partners/Vendors", "WH/Stock", 5, "Done"],
    ["__export__.sml_4", "2026-09-10", "WH/INT/00007", "[P1] Mask", "WH/Stock", "WH/Rental", 1, "Done"],
  ]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const STOCK_FILE = { name: "stock.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };

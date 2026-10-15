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

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
async function oneSheet(rows: (string | number)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Sheet1").addRows(rows);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
/**
 * The same made-up stock as Odoo saves it: one export per file, import-compatible (ID) with "Last Updated on".
 * value3: the second receipt's value (change it, with a later date, to test "Add new and changed records");
 * badRow: add a valuation row whose quantity is text.
 */
export async function stockFiles(opts: { value3?: number; updated3?: string; badRow?: boolean } = {}) {
  const v3 = opts.value3 ?? 100;
  const valuation = await oneSheet([
    ["ID", "Last Updated on", "Created on", "Reference", "Product", "Quantity", "Unit Value", "Total Value"],
    ["__export__.svl_1", "2026-09-02 10:00:00", "2026-09-02", "WH/IN/00001", "[P1] Mask", 10, 100, 1000],
    ["__export__.svl_2", "2026-09-05 10:00:00", "2026-09-05", "WH/OUT/00001", "[P1] Mask", -4, 100, -400],
    ["__export__.svl_3", opts.updated3 ?? "2026-09-06 10:00:00", "2026-09-06", "WH/IN/00002", "[P2] Tube", 5, v3 / 5, v3],
    ...(opts.badRow ? [["__export__.svl_9", "2026-09-07 10:00:00", "2026-09-07", "WH/IN/00009", "[P2] Tube", "five", 20, 100]] : []),
  ]);
  const moves = await oneSheet([
    ["ID", "Last Updated on", "Date", "Reference", "Product", "From", "To", "Quantity", "Status"],
    ["__export__.sml_1", "2026-09-02 10:00:00", "2026-09-02", "WH/IN/00001", "[P1] Mask", "Partners/Vendors", "WH/Stock", 10, "Done"],
    ["__export__.sml_2", "2026-09-05 10:00:00", "2026-09-05", "WH/OUT/00001", "[P1] Mask", "WH/Stock", "Partners/Customers", 4, "Done"],
    ["__export__.sml_3", "2026-09-06 10:00:00", "2026-09-06", "WH/IN/00002", "[P2] Tube", "Partners/Vendors", "WH/Stock", 5, "Done"],
    ["__export__.sml_4", "2026-09-10 10:00:00", "2026-09-10", "WH/INT/00007", "[P1] Mask", "WH/Stock", "WH/Rental", 1, "Done"],
  ]);
  return [
    { name: "Stock Valuation Layer (stock.valuation.layer).xlsx", mimeType: XLSX_TYPE, buffer: valuation },
    { name: "Product Moves (stock.move.line).xlsx", mimeType: XLSX_TYPE, buffer: moves },
  ];
}

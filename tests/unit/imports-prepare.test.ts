import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseFiles, sampleFile } from "@/lib/imports/prepare";

async function xlsx(rows: (string | number | null)[][], sheets = 1): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  for (let k = 0; k < sheets; k++) wb.addWorksheet(`Sheet${k + 1}`).addRows(rows);
  const b = Buffer.from(await wb.xlsx.writeBuffer());
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}
const VAL = [
  ["ID", "Last Updated on", "Created on", "Product", "Quantity", "Reference", "Total Value"],
  ...Array.from({ length: 150 }, (_, i) => [`svl_${i + 1}`, "2026-09-02 10:00:00", "2026-09-02", "[P1] Mask", 1, `WH/IN/${i + 1}`, 100]),
  ["svl_x", "", "2026-09-03", "[P1] Mask", "abc", "WH/IN/X", 5],
];
const MOVES = [
  ["ID", "Date", "Product", "From", "To", "Quantity", "Reference", "Status"],
  ["sml_1", "2026-09-02", "[P1] Mask", "WH/Stock", "Partner Locations/Vendors", 1, "WH/IN/1", "done"],
];

describe("the background reader", () => {
  it("samples only the first rows: which export, how its columns map, a few rows, and the file's full size", async () => {
    const [s] = [await sampleFile("Stock Valuation Layer.xlsx", await xlsx(VAL))];
    expect(s.export).toBe("stock.valuation.layer");
    expect(s.totalRows).toBe(151);
    expect(s.columns!.missing).toEqual([]);
    expect(s.columns!.fields.find((f) => f.field === "updated")).toMatchObject({ heading: "Last Updated on" });
    expect(s.preview).toHaveLength(8);
    expect(s.preview[0]).toMatchObject({ Date: "2026-09-02", Product: "[P1] Mask", Value: "100" });
    // The bad row is past the sample: it is found when the whole file is read.
    expect(s.issues).toEqual([]);
  });

  it("refuses a workbook holding several sheets (Odoo saves one export per file)", async () => {
    expect((await sampleFile("two.xlsx", await xlsx(MOVES, 2))).export).toBeNull();
  });

  it("reads every row into numbered records: data for valid rows, the error for unreadable ones; valuation kinds come from the moves", async () => {
    const r = await parseFiles([
      { name: "v.xlsx", data: await xlsx(VAL), export: "stock.valuation.layer" },
      { name: "m.xlsx", data: await xlsx(MOVES), export: "stock.move.line" },
    ], { rentalLocation: null, asOf: "2026-10-15" });
    const [v, m] = r.files;
    expect([v.valid, v.invalid, v.records.length]).toEqual([150, 1, 151]);
    expect(v.records.map((x) => x.n)).toEqual(Array.from({ length: 151 }, (_, i) => i + 1));
    expect(v.records[0]).toMatchObject({ n: 1, line: 2, data: { odoo_key: "svl_1", updated_at: "2026-09-02 10:00:00", kind: "supplier_return", value: 100 } });
    expect(v.records[150]).toEqual({ n: 151, line: 152, error: 'Quantity is not a number: "abc"' });
    expect(m.records[0].data).toMatchObject({ odoo_key: "sml_1", kind: "supplier_return", from_loc: "WH/Stock" });
    expect(v.months).toEqual(["2026-09"]);
  });
});

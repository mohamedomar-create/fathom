// Records read by the intake become exactly the lines each module's own save takes, so saving through the wizard is the
// same as uploading on the module's card. The preview shows them in AQL360's template, and the template reads back the same.
import { describe, expect, it } from "vitest";
import type { Grid } from "@/lib/ingest/extract";
import { pieceOf } from "@/lib/intake/split";
import { mapPiece } from "@/lib/intake/map";
import { readRecords } from "@/lib/intake/records";
import { moduleByKey } from "@/lib/modules/registry";
import { toSalesLines, toExpenseLines, toPaymentLines, toGenericRows, templateOf } from "@/lib/intake/adapters";

const g = (name: string, rows: unknown[][]): Grid => ({ name, rows: rows as Grid["rows"] });
const read = (key: string, grid: Grid) => { const m = moduleByKey(key)!; const p = pieceOf(grid); return readRecords(p, m, mapPiece(p, m)).records; };

describe("adapters", () => {
  it("makes sales lines: the untaxed amount, else the total; the invoice series from its number", () => {
    const rs = read("sales", g("S", [["Date", "Number", "Customer", "Product", "Quantity", "Untaxed Amount", "Total"], ["01/10/2026", "INV/2026/0001", "Nile", "[Acme] Mask", 2, 100, 114], ["02/10/2026", "RINV/2026/0002", "Delta", "Pump", 1, null, -57]]));
    const lines = toSalesLines(rs, "S");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ day: "2026-10-01", period: "2026-10", doc: "INV/2026/0001", series: "INV", customer: "Nile", qty: 2, amount: 100, src: { sheet: "S", row: 2 } });
    expect(lines[1]).toMatchObject({ amount: -57, series: "RINV" });
  });

  it("makes expense lines with the supplier, the account or type, and the amount", () => {
    const rs = read("expenses", g("E", [["Date", "Vendor", "Category", "Label", "Amount"], ["01/10/2026", "Rent Co", "Rent", "October rent", 9000]]));
    expect(toExpenseLines(rs, "E")[0]).toMatchObject({ day: "2026-10-01", period: "2026-10", supplier: "Rent Co", account: "Rent", category: "Rent", label: "October rent", amount: 9000, cls: null });
  });

  it("makes payments: positive received, negative paid, unless a type column says which", () => {
    const rs = read("payments", g("P", [["Date", "Number", "Journal", "Partner", "Amount"], ["01/10/2026", "P1", "Bank", "Nile", 500], ["02/10/2026", "P2", "Bank", "Power", -200]]));
    const ls = toPaymentLines(rs, "EGP");
    expect(ls.map((l) => [l.direction, l.amount])).toEqual([["in", 500], ["out", -200]]);
    expect(ls[0]).toMatchObject({ day: "2026-10-01", period: "2026-10", number: "P1", journal: "Bank", partner: "Nile", currency: "EGP", state: "paid" });
  });

  it("keeps every field of a new module's row for the shared store", () => {
    const rs = read("purchasing", g("PO", [["PO Number", "Vendor", "PO Date", "Product", "Ordered Quantity", "Received Quantity", "Billed Quantity", "Untaxed Amount"], ["P00001", "Acme", "01/10/2026", "Mask", 10, 8, 5, 1000]]));
    const rows = toGenericRows(rs, moduleByKey("purchasing")!);
    expect(rows[0]).toMatchObject({ period: "2026-10", day: "2026-10-01", doc: "P00001", partner: "Acme", amount: 1000, qty: 10, data: { product: "Mask", received: 8, billed: 5 } });
  });

  it("previews any module in AQL360's template, which reads back to the same records", () => {
    const m = moduleByKey("ar_open")!;
    const rs = read("ar_open", g("AR", [["Client", "Invoice", "Due date", "Balance"], ["Nile", "INV/1", "04/09/2026", 12000]]));
    const t = templateOf(m, rs);
    expect(t.rows[0]).toEqual(m.fields.map((f) => f.heading));
    const back = readRecords(pieceOf(t), m, mapPiece(pieceOf(t), m)).records;
    expect(back.map(({ __row, ...r }) => (void __row, r))).toEqual(rs.map(({ __row, ...r }) => (void __row, r)));
  });
});

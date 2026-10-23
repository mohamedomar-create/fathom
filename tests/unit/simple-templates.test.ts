import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildTemplate } from "@/lib/templates/build";
import { readWorkbook } from "@/lib/ingest/read";
import { readSalesGrid } from "@/lib/ingest/sales";
import { readExpenseGrid } from "@/lib/ingest/expenses";
import { TEMPLATE_KINDS } from "@/lib/templates/spec";

const O = { year: 2026, fyStart: 1, currency: "EGP" };
async function filled(kind: "simple-sales" | "simple-expenses", row: (string | number | Date)[]) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildTemplate(kind, O) as unknown as ArrayBuffer);
  const ws = wb.getWorksheet(kind === "simple-sales" ? "Sales" : "Expenses")!;
  ws.getRow(2).values = row;
  const buf = await wb.xlsx.writeBuffer();
  return readWorkbook(buf as ArrayBuffer, `${kind}.xlsx`);
}

describe("Simple-mode blank templates", () => {
  it("both are offered", () => {
    expect(TEMPLATE_KINDS).toContain("simple-sales");
    expect(TEMPLATE_KINDS).toContain("simple-expenses");
  });
  it("a filled Sales template reads back with every column", async () => {
    const grids = await filled("simple-sales", [new Date(Date.UTC(2026, 0, 5)), 1200, "Nile", "Consulting", 2, 400, "Online", "No", ""]);
    const r = readSalesGrid(grids.find((g) => g.name === "Sales")!, {}, { simple: true })!;
    expect(r.layout.columns.filter((c) => c.field).map((c) => c.field)).toEqual(["date", "untaxed", "customer", "product", "qty", "cost", "channel", "paid", "paidOn"]);
    expect(r.lines.map((l) => [l.day, l.amount, l.customer, l.cost, l.channel, l.paid])).toEqual([["2026-01-05", 1200, "Nile", 400, "Online", false]]);
  });
  it("a filled Expenses template reads back with every column", async () => {
    const grids = await filled("simple-expenses", [new Date(Date.UTC(2026, 0, 3)), 5000, "Rent", "Landlord", "Fixed", "Yes", ""]);
    const r = readExpenseGrid(grids.find((g) => g.name === "Expenses")!, {}, { simple: true })!;
    expect(r.layout.columns.filter((c) => c.field).map((c) => c.field)).toEqual(["date", "untaxed", "category", "supplier", "fixedVar", "paid", "paidOn"]);
    expect(r.lines.map((l) => [l.day, l.amount, l.category, l.supplier, l.cls, l.paid])).toEqual([["2026-01-03", 5000, "Rent", "Landlord", "exp_fixed", true]]);
  });
});

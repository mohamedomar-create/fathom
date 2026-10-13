import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildTemplate } from "@/lib/templates/build";
import { classChoice, MARK, templateMonths } from "@/lib/templates/spec";
import { readWorkbook } from "@/lib/ingest/read";
import { ingest, toAccountInputs } from "@/lib/ingest/pipeline";
import { buildMonths } from "@/lib/company/build";
import { readSalesGrid } from "@/lib/ingest/sales";
import { problemText, templateMarkOf, templateProblems } from "@/lib/ingest/template";

const OPTS = { fyStart: 1, ytd: "auto" as const, closeEarnings: "auto" as const, plugEquity: false, mapping: {}, today: "2027-02-01" };
const O = { year: 2026, fyStart: 1, currency: "EGP" };

/** Fills a template the way a person would: amounts typed into the month columns, rows renamed or added. */
async function filled(kind: "financials" | "sales", edit: (wb: ExcelJS.Workbook) => void) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buildTemplate(kind, O) as unknown as ArrayBuffer);
  edit(wb);
  const buf = await wb.xlsx.writeBuffer();
  return readWorkbook(buf as ArrayBuffer, `${kind}.xlsx`);
}
const rowOf = (ws: ExcelJS.Worksheet, name: string) => { let n = 0; ws.eachRow((r, i) => { if (r.getCell(2).value === name) n = i; }); return ws.getRow(n); };

/** Two months of a small trading company: P&L and month-end balances that balance (retained earnings include profit to date). */
function fillFinancials(wb: ExcelJS.Workbook) {
  const pl = wb.getWorksheet("P&L")!, bs = wb.getWorksheet("Balance Sheet")!;
  const P: [string, number, number][] = [["Sales revenue", 100000, 120000], ["Cost of goods sold", 60000, 70000], ["Salaries and wages", 20000, 20000], ["Rent", 5000, 5000], ["Income tax", 3000, 5000]];
  for (const [n, a, b] of P) { const r = rowOf(pl, n); r.getCell(4).value = a; r.getCell(5).value = b; }
  // Opening (Dec 2025), Jan, Feb. Profit: Jan 12,000, Feb 20,000.
  const B: [string, number, number, number][] = [
    ["Cash in hand and banks", 50000, 57000, 72000], ["Customers", 30000, 35000, 40000], ["Inventory", 20000, 20000, 25000],
    ["Suppliers", 25000, 25000, 30000], ["Share capital", 50000, 50000, 50000], ["Retained earnings incl. profit to date", 25000, 37000, 57000],
  ];
  for (const [n, o, a, b] of B) { const r = rowOf(bs, n); r.getCell(4).value = o; r.getCell(5).value = a; r.getCell(6).value = b; }
  // An account the person adds, with a class from the list.
  const extra = bs.getRow(30);
  extra.getCell(1).value = "1290"; extra.getCell(2).value = "Staff loans"; extra.getCell(3).value = classChoice("other_ca");
}

describe("the financial template", () => {
  it("is read exactly: every figure in the class the row names, opening balance as its own month, balancing", async () => {
    const grids = await filled("financials", fillFinancials);
    expect(grids.map(templateMarkOf)).toEqual([null, null, "pl", "bs"]);
    expect(templateProblems(grids)).toEqual([]);
    const res = ingest(grids, OPTS);
    // The opening balance column is a month of its own (balance sheet only).
    expect(res.periods).toEqual(["2025-12", "2026-01", "2026-02"]);
    const ms = buildMonths(toAccountInputs(res).map((a, i) => ({ id: String(i), ...a })));
    const m = (p: string) => ms.find((x) => x.period === p)!;
    expect(m("2025-12").has).toEqual({ pl: false, bs: true });
    expect(m("2026-01").pl).toMatchObject({ revenue: 100000, cos_variable: 60000, exp_fixed: 25000, tax_expenses: 3000 });
    expect(m("2026-02").bs).toMatchObject({ cash: 72000, ar: 40000, inventory: 25000, ap: 30000, other_equity: 50000, retained_earnings: 57000 });
    for (const v of Object.values(res.imbalance)) expect(Math.abs(v)).toBeLessThan(0.01);
    // Nothing guessed: every line says it took the template's class.
    expect(res.lines.filter((l) => !l.system).every((l) => l.why === "class given in the iReport template" && l.conf === 1)).toBe(true);
  });

  it("lists every mistake with its sheet, row and column, so nothing is imported half-right", async () => {
    const grids = await filled("financials", (wb) => {
      fillFinancials(wb);
      const pl = wb.getWorksheet("P&L")!;
      rowOf(pl, "Rent").getCell(5).value = "five thousand";
      const r = pl.getRow(40); r.getCell(2).value = "Bank loan"; r.getCell(3).value = classChoice("ltd"); r.getCell(4).value = 1000;
      const r2 = pl.getRow(41); r2.getCell(2).value = "Mystery"; r2.getCell(4).value = 500;
      pl.getRow(5).getCell(6).value = "March";
    });
    const ps = templateProblems(grids);
    expect(ps.map((p) => [p.row, p.col])).toEqual([[5, "F"], [11, "E"], [40, "C"], [41, "C"]]);
    expect(problemText(ps)).toContain("P&L, row 11, column E: \"five thousand\" is not a number");
    expect(ps[2].message).toContain("balance sheet class");
  });

  it("puts the months of the company's financial year in the headings", async () => {
    expect(templateMonths(2026, 7)).toMatchObject({ opening: "2026-06", months: expect.arrayContaining(["2026-07", "2027-06"]) });
  });
});

describe("the sales template", () => {
  it("is checked row by row, then read by the sales reader", async () => {
    const grids = await filled("sales", (wb) => {
      const ws = wb.getWorksheet("Sales")!;
      const rows: (string | number | Date)[][] = [
        [new Date(Date.UTC(2026, 0, 15)), "INV/2026/0001", "Clinic A", "Concentrator", "Devices", "Sara", 2, 20000, 13000],
        ["03/02/2026", "INV/2026/0002", "Clinic B", "Mask", "Consumables", "Omar", 10, 2600, 1500],
        [new Date(Date.UTC(2026, 1, 20)), "RINV/2026/0001", "Clinic B", "Mask", "Consumables", "Omar", -1, -260, -150],
      ];
      rows.forEach((r, i) => r.forEach((v, j) => { ws.getRow(5 + i).getCell(j + 1).value = v; }));
    });
    const sheet = grids.find((g) => templateMarkOf(g) === "sales")!;
    expect(templateProblems(grids)).toEqual([]);
    const r = readSalesGrid(sheet);
    expect(r?.lines.map((l) => [l.period, l.customer, l.product, l.category, l.qty, l.amount, l.cost])).toEqual([
      ["2026-01", "Clinic A", "Concentrator", "Devices", 2, 20000, 13000],
      ["2026-02", "Clinic B", "Mask", "Consumables", 10, 2600, 1500],
      ["2026-02", "Clinic B", "Mask", "Consumables", -1, -260, -150],
    ]);
    expect(r?.layout.taxIncluded).toBe(false);
  });

  it("names missing required cells and bad dates or numbers", async () => {
    const grids = await filled("sales", (wb) => {
      const ws = wb.getWorksheet("Sales")!;
      [["31/31/2026", "X", "", "Mask", "", "", "two", 100, ""]].forEach((r, i) => r.forEach((v, j) => { if (v !== "") ws.getRow(5 + i).getCell(j + 1).value = v; }));
    });
    expect(templateProblems(grids).map((p) => p.col)).toEqual(["A", "C", "G"]);
  });

  it("an accounting file is never taken for a template", () => {
    expect(templateMarkOf({ name: "x", rows: [["Code", "Account"], ["4000", "Sales", 100]] })).toBeNull();
    expect(templateMarkOf({ name: "x", rows: [[MARK.pl]] })).toBe("pl");
  });
});


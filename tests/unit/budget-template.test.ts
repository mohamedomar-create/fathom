import { describe, expect, it } from "vitest";
import { readWorkbook } from "@/lib/ingest/read";
import { buildBudgetWorkbook, readBudgetGrids, BUDGET_MARK } from "@/lib/budget/template";
import { fyMonths, type BudgetLine, type BudgetProduct } from "@/lib/engine/budget";

const months = fyMonths("2026", 1);
const lines: BudgetLine[] = [
  { key: "#410000", cls: "revenue", label: "410000 Revenue", month: "2026-01", amount: 1000 },
  { key: "#410000", cls: "revenue", label: "410000 Revenue", month: "2026-12", amount: 1200.5 },
  { key: "cls:exp_fixed", cls: "exp_fixed", label: null, month: "2026-03", amount: 300 },
];
const products: BudgetProduct[] = [{ product: "Mask", category: "Care", month: "2026-02", units: 10, price: 50, unit_cost: 20 }];

describe("budget template", () => {
  it("downloads and reads back the same lines and products", async () => {
    const buf = await buildBudgetWorkbook({ lines, products, months, accounts: [{ key: "#620000", cls: "exp_variable", label: "620000 Travel" }] });
    const grids = await readWorkbook(buf, "budget.xlsx");
    expect(String(grids[0].rows[0][0])).toBe(BUDGET_MARK.lines);
    const r = readBudgetGrids(grids, months);
    expect(r.errors).toEqual([]);
    expect(r.lines).toEqual(expect.arrayContaining(lines.map((l) => expect.objectContaining({ key: l.key, cls: l.cls, month: l.month, amount: l.amount }))));
    expect(r.lines).toHaveLength(3); // the blank Travel row adds nothing
    expect(r.products).toEqual(products);
  });
  it("a changed cell comes back changed; a class outside the P&L or a month outside the year is reported", () => {
    const grids = [{ name: "Budget", rows: [[BUDGET_MARK.lines], ["Key", "Account", "Class", ...months], ["#1", "One", "revenue", 5, "x"], ["#2", "Bank", "cash", 1], ["", "Two", "exp_fixed", 7]] }];
    const r = readBudgetGrids(grids, months);
    expect(r.lines).toEqual([
      { key: "#1", cls: "revenue", label: "One", month: "2026-01", amount: 5 },
      { key: "@two", cls: "exp_fixed", label: "Two", month: "2026-01", amount: 7 },
    ]);
    expect(r.errors.join(" ")).toMatch(/row 4.*cash/i);
    expect(r.errors.join(" ")).toMatch(/row 3.*x/i);
  });
  it("a sheet that isn't the budget template is refused", () => {
    expect(readBudgetGrids([{ name: "S", rows: [["Date", "Amount"]] }], months).errors[0]).toMatch(/budget template/i);
  });
});

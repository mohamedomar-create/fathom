import { describe, expect, it } from "vitest";
import { readExpenseGrid } from "@/lib/ingest/expenses";
import { accountsFromLines, isCostLine, summariseExpenses } from "@/lib/engine/expenses";

// A distributor on perpetual stock: most vendor bills go to Stock Interim (Received). Panel C04: these became fixed costs.
const rows = [
  ["Bill Date", "Number", "Vendor", "Account", "Untaxed Amount"],
  ["2026-03-02", "BILL/2026/0001", "Pharma Supply", "Stock Interim (Received)", 400000],
  ["2026-03-05", "BILL/2026/0002", "Med Import", "Stock Interim (Received)", 310000],
  ["2026-03-07", "BILL/2026/0003", "Cairo Property", "Rent", 30000],
  ["2026-03-09", "BILL/2026/0004", "Misr Power", "Electricity", 4500],
  ["2026-03-12", "BILL/2026/0005", "Delta Goods", "المخزون", 20000],
];

describe("a vendor-bills file with stock purchases", () => {
  it("keeps stock purchases out of costs and still lists them under their suppliers", () => {
    const r = readExpenseGrid({ name: "Bills", rows: rows as never })!;
    const stock = r.lines.filter((l) => !isCostLine(l.cls));
    expect(stock.map((l) => l.supplier).sort()).toEqual(["Delta Goods", "Med Import", "Pharma Supply"]);
    const costs = accountsFromLines(summariseExpenses(r.lines.map((l) => ({ ...l, source: "file" as const })), "file"));
    const total = costs.reduce((a, c) => a + Object.values(c.amounts).reduce((x, y) => x + y, 0), 0);
    expect(total).toBe(34500);
    expect(costs.map((c) => c.name).sort()).toEqual(["Electricity", "Rent"]);
  });
});

describe("costs whose names mention stock stay costs", () => {
  it.each(["Inventory write-off", "Inventory adjustment", "Stock losses", "عجز المخزون", "Stock transport", "Merchandise purchases", "تكلفة البضاعة المباعة", "Cost of goods sold"])("%s is a cost", (account) => {
    const r = readExpenseGrid({ name: "Bills", rows: [["Bill Date", "Number", "Vendor", "Account", "Untaxed Amount"], ["2026-03-02", "BILL/1", "A Supplier", account, 1000], ["2026-03-03", "BILL/2", "B Supplier", "Rent", 500]] as never })!;
    expect(r.lines.every((l) => isCostLine(l.cls))).toBe(true);
  });
});

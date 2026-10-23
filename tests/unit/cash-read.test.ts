import { describe, expect, it } from "vitest";
import { readCashBook, readCashGrid } from "@/lib/cash/read";

const g = (name: string, rows: unknown[][]) => ({ name, rows: rows as never });
const brief = (es: { day: string; direction: string; amount: number }[]) => es.map((e) => `${e.day} ${e.direction} ${e.amount}`);

describe("reading a small company's sheets", () => {
  it("one sheet with In and Out columns (a kiosk's cash book)", () => {
    const r = readCashGrid(g("Book", [
      ["Date", "Description", "In", "Out"],
      ["01/03/2026", "Sales", 1200, null],
      ["01/03/2026", "Bread", null, 300],
      ["02/03/2026", "Sales and rent", 900, 2000],
    ]))!;
    expect(r.layout).toBe("inout");
    expect(brief(r.entries)).toEqual(["2026-03-01 in 1200", "2026-03-01 out 300", "2026-03-02 in 900", "2026-03-02 out 2000"]);
    expect(r.entries[1].note).toBe("Bread");
  });
  it("one list with an amount and a type", () => {
    const r = readCashGrid(g("Moves", [["Date", "Type", "Category", "Amount"], ["2026-03-01", "Sale", "Drinks", 50], ["2026-03-01", "Expense", "Ice", 20], ["2026-03-02", "?", "x", 5]]))!;
    expect(r.layout).toBe("typed");
    expect(brief(r.entries)).toEqual(["2026-03-01 in 50", "2026-03-01 out 20"]);
    expect(r.skipped).toEqual([{ sheet: "Moves", row: 4, reason: 'type "?" is neither money in nor money out' }]);
  });
  it("a Sales sheet and an Expenses sheet, told apart by their names", () => {
    const b = readCashBook([
      g("Sales", [["Date", "Customer", "Amount", "Paid"], ["05/01/2026", "Nile", 1000, "Yes"], ["20/01/2026", "Delta", 500, "No"]]),
      g("Expenses", [["Date", "Category", "Amount"], ["15/01/2026", "Rent", 700]]),
    ]);
    expect(brief(b.entries)).toEqual(["2026-01-05 in 1000", "2026-01-20 in 500", "2026-01-15 out 700"]);
    expect(b.entries.map((e) => [e.party, e.paid])).toEqual([["Nile", true], ["Delta", false], ["", null]]);
    expect(b.months).toEqual(["2026-01"]);
  });
  it("an amount-only sheet whose name says nothing waits for the person to say which it is", () => {
    const r = readCashGrid(g("Sheet1", [["Date", "Amount"], ["05/01/2026", 10]]))!;
    expect(r.layout).toBe("amount");
    expect(r.needsKind).toBe(true);
    expect(r.entries).toEqual([]);
    expect(brief(readCashGrid(g("Sheet1", [["Date", "Amount"], ["05/01/2026", 10]]), { kind: "out" })!.entries)).toEqual(["2026-01-05 out 10"]);
  });
  it("Arabic headings", () => {
    const r = readCashGrid(g("الدفتر", [["التاريخ", "البيان", "وارد", "منصرف"], ["٠١/٠٣/٢٠٢٦", "مبيعات", "١٬٢٠٠", ""], ["02/03/2026", "إيجار", "", 500]]))!;
    expect(brief(r.entries)).toEqual(["2026-03-01 in 1200", "2026-03-02 out 500"]);
  });
  it("a messy sheet: title rows, text numbers, real dates, blank and total rows; every skip has its reason", () => {
    const r = readCashGrid(g("Shop", [
      ["Corner Shop – March"], [],
      ["Date", "Item", "Money in", "Money out"],
      [new Date(2026, 2, 1), "Sales", "1,284.50", ""],
      [],
      ["soon", "Sales", 100, ""],
      ["03/03/2026", "Sales", "", ""],
      ["Total", "", "1,384.50", ""],
    ]))!;
    expect(brief(r.entries)).toEqual(["2026-03-01 in 1284.5"]);
    expect(r.skipped.map((s) => [s.row, s.reason])).toEqual([[6, '"soon" is not a date'], [7, "no amount"], [8, "total row"]]);
  });
  it("month-first dates are read when a date proves it", () => {
    const r = readCashGrid(g("Book", [["Date", "In"], ["03/15/2026", 10], ["03/01/2026", 20]]))!;
    expect(r.entries.map((e) => e.day)).toEqual(["2026-03-15", "2026-03-01"]);
  });
  it("Excel date numbers", () => {
    const r = readCashGrid(g("Book", [["Date", "In"], [46082, 10]]))!;
    expect(r.entries[0].day).toBe("2026-03-01");
  });
  it("the person's column choices win", () => {
    const r = readCashGrid(g("Book", [["When", "Takings", "Spent"], ["01/03/2026", 10, 4]]), { map: { when: "date", takings: "in", spent: "out" } })!;
    expect(brief(r.entries)).toEqual(["2026-03-01 in 10", "2026-03-01 out 4"]);
  });
  it("a sheet with no date or no amount column is not a cash sheet", () => {
    expect(readCashGrid(g("Notes", [["Name", "Phone"], ["A", "1"]]))).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { readCashBook } from "@/lib/cash/read";
import { cashAdvice, unreadRows } from "@/lib/cash/advice";

const g = (name: string, rows: unknown[][], origin?: { r: number; c: number }) => ({ name, rows: rows as never, origin });

describe("advice on how to fix a sheet", () => {
  it("dates that cannot be read are named by cell and value, first and as things to fix", () => {
    const s = readCashBook([g("Sales", [["Date", "Amount", "Till"], ["soon", 5, "1"], ["01/03/2026", 7, "1"], ["tomorrow", 3, "2"], ["Total", 15, ""]])]).sheets[0];
    const a = cashAdvice(s);
    expect(a[0]).toEqual({ level: "fix", code: "badDates", args: { n: 2, cells: 'A2 "soon", A4 "tomorrow"' } });
    expect(a.map((x) => x.code)).toEqual(expect.arrayContaining(["unused", "totals"]));
    expect(a.find((x) => x.code === "unused")!.args.columns).toBe("C Till");
  });
  it("a sheet with no date says to add or choose one; one that needs a choice says so", () => {
    expect(cashAdvice(readCashBook([g("Notes", [["Customer", "Amount"], ["A", 1]])]).sheets[0]).map((x) => [x.level, x.code])).toContainEqual(["fix", "noDate"]);
    expect(cashAdvice(readCashBook([g("Sheet1", [["Date", "Amount"], ["01/03/2026", 1]])]).sheets[0]).map((x) => [x.level, x.code])).toContainEqual(["fix", "needKind"]);
  });
  it("cell letters and rows follow the file even when the table starts lower and further right", () => {
    const s = readCashBook([g("Sales", [["Date", "Amount"], ["soon", 5]], { r: 4, c: 3 })]).sheets[0];
    expect(cashAdvice(s)[0].args.cells).toBe('D6 "soon"');
  });
  it("the rows that could not be read come back whole, with why", () => {
    const rows = [["Date", "Amount"], ["soon", 5], ["01/03/2026", 7]];
    const s = readCashBook([g("Sales", rows)]).sheets[0];
    expect(unreadRows(s, rows)).toEqual([{ row: 2, why: '"soon" is not a date', cells: ["soon", 5] }]);
  });
});

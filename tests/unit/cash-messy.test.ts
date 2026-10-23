import { describe, expect, it } from "vitest";
import { readCashBook, type CashBook } from "@/lib/cash/read";

/** Made-up shop sheets in the shapes owners really keep them: each must read to exact totals, or say exactly why not. */
const g = (name: string, rows: unknown[][], origin?: { r: number; c: number }) => ({ name, rows: rows as never, origin });
const sum = (b: CashBook, d: "in" | "out") => Math.round(b.entries.filter((e) => e.direction === d).reduce((s, e) => s + e.amount, 0) * 100) / 100;
const totals = (b: CashBook) => ({ entries: b.entries.length, in: sum(b, "in"), out: sum(b, "out") });
const codes = (b: CashBook) => b.sheets.flatMap((s) => s.notes.map((n) => n.code));

describe("headings with extra words, units and Arabic phrasing", () => {
  it("'Sales Amount' and 'Expense Amount'", () => {
    expect(totals(readCashBook([g("March", [["Date", "Details", "Sales Amount", "Expense Amount"], ["01/03/2026", "x", 100, ""], ["02/03/2026", "y", "", 40]])]))).toEqual({ entries: 2, in: 100, out: 40 });
  });
  it("'Invoice Date' and 'Amount (EGP)' on a Sales sheet", () => {
    const b = readCashBook([g("Sales", [["Invoice Date", "Customer", "Amount (EGP)"], ["01/03/2026", "Nile", 100]])]);
    expect(totals(b)).toEqual({ entries: 1, in: 100, out: 0 });
    expect(b.entries[0].party).toBe("Nile");
  });
  it("'Date of sale' and 'Total sale'", () => {
    expect(totals(readCashBook([g("Sheet1", [["Date of sale", "Product", "Total sale"], ["01/03/2026", "x", 10]])]))).toEqual({ entries: 1, in: 10, out: 0 });
  });
  it("Arabic 'قيمة المبيعات' and 'قيمة المصروفات'", () => {
    expect(totals(readCashBook([g("مارس", [["التاريخ", "قيمة المبيعات", "قيمة المصروفات"], ["01/03/2026", 100, 20]])]))).toEqual({ entries: 2, in: 100, out: 20 });
  });
  it("'Expense type' is what it was spent on, not money out", () => {
    const b = readCashBook([g("Expenses", [["Date", "Expense type", "Amount"], ["01/03/2026", "Rent", 500]])]);
    expect(totals(b)).toEqual({ entries: 1, in: 0, out: 500 });
    expect(b.entries[0].category).toBe("Rent");
  });
  it("a text column under a money word ('Expense' holding names) is read as the category", () => {
    const b = readCashBook([g("Expenses", [["Date", "Expense", "Amount"], ["01/03/2026", "Electric", 100]])]);
    expect(totals(b)).toEqual({ entries: 1, in: 0, out: 100 });
    expect(b.entries[0].category).toBe("Electric");
  });
});

describe("cash-book layouts", () => {
  it("Debit / Credit with a balance: debit is money in, credit money out, the balance is not used", () => {
    const b = readCashBook([g("Cash", [["Date", "Statement", "Debit", "Credit", "Balance"], ["01/03/2026", "sale", 100, "", 100], ["02/03/2026", "rent", "", 30, 70]])]);
    expect(totals(b)).toEqual({ entries: 2, in: 100, out: 30 });
    expect(codes(b)).toEqual(expect.arrayContaining(["debitCredit", "balance"]));
    // The person can say the columns are the other way round.
    expect(totals(readCashBook([g("Cash", [["Date", "Debit", "Credit"], ["01/03/2026", 100, ""]])], { sheets: { Cash: { swap: true } } }))).toEqual({ entries: 1, in: 0, out: 100 });
  });
  it("Arabic مدين / دائن / الرصيد", () => {
    expect(totals(readCashBook([g("الخزنة", [["التاريخ", "البيان", "مدين", "دائن", "الرصيد"], ["01/03/2026", "مبيعات", 100, "", 100], ["02/03/2026", "ايجار", "", 30, 70]])]))).toEqual({ entries: 2, in: 100, out: 30 });
  });
  it("Receipts / Payments / Balance (petty cash)", () => {
    expect(totals(readCashBook([g("Petty cash", [["Date", "Description", "Receipts", "Payments", "Balance"], ["01/03/2026", "float", 1000, "", 1000], ["02/03/2026", "taxi", "", 50, 950]])]))).toEqual({ entries: 2, in: 1000, out: 50 });
  });
  it("'CASH IN' with odd spacing and text numbers", () => {
    expect(totals(readCashBook([g("Sheet1", [[" DATE ", "CASH IN", "CASH OUT"], ["01/03/2026", "1,200.50", ""]])]))).toEqual({ entries: 1, in: 1200.5, out: 0 });
  });
  it("a minus sign in the Out column is still money out (noted), a minus in the In column is a refund", () => {
    const b = readCashBook([g("Book", [["Date", "In", "Out"], ["01/03/2026", "", "-500"], ["02/03/2026", -20, ""]])]);
    expect(totals(b)).toEqual({ entries: 2, in: -20, out: 500 });
    expect(codes(b)).toEqual(expect.arrayContaining(["negOut", "refunds"]));
  });
  it("one signed amount column: positive money in, negative money out", () => {
    const b = readCashBook([g("Transactions", [["Date", "Description", "Amount"], ["01/03/2026", "sale", 100], ["02/03/2026", "rent", -40]])]);
    expect(b.sheets[0].layout).toBe("signed");
    expect(totals(b)).toEqual({ entries: 2, in: 100, out: 40 });
  });
});

describe("amounts worked out or refused", () => {
  it("Qty × Unit price when there is no total", () => {
    const b = readCashBook([g("Sales", [["Date", "Item", "Qty", "Unit Price"], ["01/03/2026", "Tea", 3, 10]])]);
    expect(totals(b)).toEqual({ entries: 1, in: 30, out: 0 });
    expect(codes(b)).toContain("qtyPrice");
  });
  it("Qty, Price and Total: the total is the amount, not the price", () => {
    expect(totals(readCashBook([g("Sales", [["Date", "Item", "Qty", "Price", "Total"], ["01/03/2026", "Tea", 3, 10, 30]])]))).toEqual({ entries: 1, in: 30, out: 0 });
  });
  it("currency text around numbers: 'EGP 1,200' and '1.200,50 ج.م'", () => {
    expect(totals(readCashBook([g("Sales", [["Date", "Amount"], ["01/03/2026", "EGP 1,200"], ["02/03/2026", "1.200,50 ج.م"]])]))).toEqual({ entries: 2, in: 2400.5, out: 0 });
  });
  it("amounts that round to nothing or are impossibly large are skipped with their reason, not sent", () => {
    const b = readCashBook([g("Sales", [["Date", "Amount"], ["01/03/2026", 0.001], ["02/03/2026", 1e16], ["03/03/2026", 5]])]);
    expect(totals(b)).toEqual({ entries: 1, in: 5, out: 0 });
    expect(b.skipped.map((s) => s.code)).toEqual(["tooSmall", "tooLarge"]);
  });
});

describe("dates however they are written", () => {
  it("headings on row 5 under a title, and dates in words", () => {
    const b = readCashBook([g("Shop", [["Corner shop"], ["March 2026"], [], ["Prepared by X"], ["Date", "Item", "Income", "Expenses"], ["1-Mar-2026", "sales", 200, ""], ["2 March 2026", "ice", "", 20]])]);
    expect(totals(b)).toEqual({ entries: 2, in: 200, out: 20 });
    expect(b.entries.map((e) => e.day)).toEqual(["2026-03-01", "2026-03-02"]);
    expect(b.entries[0].src.row).toBe(6);
  });
  it("'March 1, 2026', 'Mar-02-2026' and a time after the date", () => {
    const b = readCashBook([g("Sales", [["Date", "Amount"], ["March 1, 2026", 100], ["Mar-02-2026", 50], ["03/03/2026 10:30", 1]])]);
    expect(b.entries.map((e) => e.day)).toEqual(["2026-03-01", "2026-03-02", "2026-03-03"]);
  });
  it("Arabic month names: '١ مارس ٢٠٢٦'", () => {
    expect(readCashBook([g("Sales", [["التاريخ", "المبلغ"], ["١ مارس ٢٠٢٦", 100]])]).entries.map((e) => e.day)).toEqual(["2026-03-01"]);
  });
  it("day numbers on a month tab take the month and year from the tab's name", () => {
    const b = readCashBook([g("January 2026", [["Day", "Sales", "Expenses"], [1, 100, 20], [2, 90, 10]])]);
    expect(totals(b)).toEqual({ entries: 4, in: 190, out: 30 });
    expect(b.entries.map((e) => e.day)).toEqual(["2026-01-01", "2026-01-01", "2026-01-02", "2026-01-02"]);
    expect(codes(b)).toContain("dayNumbers");
  });
  it("day numbers with no month anywhere: nothing guessed, the fix is named", () => {
    const b = readCashBook([g("Sheet1", [["Day", "Sales"], [1, 100]])]);
    expect(b.entries).toEqual([]);
    expect(b.sheets[0].status).toBe("blocked");
    expect(codes(b)).toContain("needMonth");
  });
});

describe("rows that are not entries", () => {
  it("section titles are left out quietly, subtotals are total rows, real rows are kept", () => {
    const b = readCashBook([g("Expenses", [["Date", "Expense", "Amount"], ["Utilities", "", ""], ["01/03/2026", "Electric", 100], ["", "Subtotal", 100], ["Rent", "", ""], ["01/03/2026", "Rent", 500]])]);
    expect(totals(b)).toEqual({ entries: 2, in: 0, out: 600 });
    expect(b.skipped.map((s) => s.code)).toEqual(["total"]);
    expect(b.sheets[0].sections).toBe(2);
  });
  it("identical rows twice are flagged as a possible double entry (both kept)", () => {
    const b = readCashBook([g("Sales", [["Date", "Amount"], ["01/03/2026", 100], ["01/03/2026", 100]])]);
    expect(b.entries).toHaveLength(2);
    expect(codes(b)).toContain("duplicates");
  });
  it("row numbers are the file's own, even when the read grid starts lower down", () => {
    const b = readCashBook([g("Sales", [["Date", "Amount"], ["soon", 5]], { r: 9, c: 2 })]);
    expect(b.skipped[0]).toMatchObject({ row: 11, code: "badDate", cell: "C11" });
  });
});

describe("whole-sheet shapes", () => {
  it("sales and expenses side by side on one sheet are read as two blocks", () => {
    const b = readCashBook([g("Book", [["Date", "Sales", "", "Date", "Expense", "Amount"], ["01/03/2026", 100, "", "01/03/2026", "Rent", 50]])]);
    expect(totals(b)).toEqual({ entries: 2, in: 100, out: 50 });
    expect(b.sheets).toHaveLength(2);
    expect(b.entries.find((e) => e.direction === "out")!.category).toBe("Rent");
  });
  it("months across the columns are read as monthly totals, money in or out from each row's name", () => {
    const b = readCashBook([g("Summary 2026", [["Item", "Jan", "Feb", "Mar", "Total"], ["Sales", 100, 120, 130, 350], ["Rent", 50, 50, 50, 150]])]);
    expect(b.sheets[0].layout).toBe("monthly");
    expect(totals(b)).toEqual({ entries: 6, in: 350, out: 150 });
    expect(b.entries[0]).toMatchObject({ day: "2026-01-01", direction: "in", category: "Sales" });
    // A row the person says is the other way round.
    const f = readCashBook([g("Summary 2026", [["Item", "Jan", "Feb", "Mar"], ["Commission", 10, "", ""]])], { sheets: { "Summary 2026": { flip: { Commission: "in" } } } });
    expect(totals(f)).toEqual({ entries: 1, in: 10, out: 0 });
  });
  it("months across the columns without a year: the year is asked for, nothing guessed", () => {
    const b = readCashBook([g("Summary", [["Item", "Jan", "Feb", "Mar"], ["Sales", 100, 120, 130]])]);
    expect(b.entries).toEqual([]);
    expect(codes(b)).toContain("needYear");
  });
  it("headings that say nothing: the date and amount columns are found from what they hold", () => {
    const b = readCashBook([g("Sales", [["When", "How much"], ["01/03/2026", 100], ["02/03/2026", 50]])]);
    expect(totals(b)).toEqual({ entries: 2, in: 150, out: 0 });
    expect(codes(b)).toEqual(expect.arrayContaining(["dateByContent", "amountByContent"]));
  });
  it("a sheet with no date anywhere is kept (never dropped) and says what to add", () => {
    const b = readCashBook([g("Sales", [["Customer", "Amount"], ["A", 100]])]);
    expect(b.ignored).toEqual([]);
    expect(b.sheets[0]).toMatchObject({ layout: "none", status: "blocked" });
    expect(codes(b)).toContain("noDate");
  });
  it("the person can say which row holds the headings", () => {
    const rows = [["Report"], ["x", "y"], ["Date", "Amount"], ["01/03/2026", 7]];
    expect(totals(readCashBook([g("Sales", rows)], { sheets: { Sales: { headerRow: 2 } } }))).toEqual({ entries: 1, in: 7, out: 0 });
  });
  it("unused columns are named so the person knows they can delete them", () => {
    const b = readCashBook([g("Sales", [["Date", "Amount", "Cashier", "Shift"], ["01/03/2026", 7, "Ali", "AM"]])]);
    const unused = b.sheets[0].notes.find((n) => n.code === "unused");
    expect(unused?.args?.columns).toBe("C Cashier, D Shift");
  });
});

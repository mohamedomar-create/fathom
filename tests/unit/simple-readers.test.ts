import { describe, expect, it } from "vitest";
import { readSalesGrid } from "@/lib/ingest/sales";
import { readExpenseGrid } from "@/lib/ingest/expenses";

const simple = { simple: true } as const;

describe("Simple mode: reading a Sales sheet", () => {
  it("a date and an amount are enough", () => {
    const r = readSalesGrid({ name: "Sales", rows: [["Date", "Amount"], ["05/01/2026", 1000], ["20/02/2026", "2,500.50"]] }, {}, simple)!;
    expect(r.lines.map((l) => [l.day, l.amount, l.customer])).toEqual([["2026-01-05", 1000, "No customer"], ["2026-02-20", 2500.5, "No customer"]]);
  });
  it("the same sheet is not a sales list in Full mode (unchanged)", () => {
    expect(readSalesGrid({ name: "Sales", rows: [["Date", "Amount"], ["05/01/2026", 1000]] })).toBeNull();
  });
  it("reads channel, paid/unpaid and payment date", () => {
    const r = readSalesGrid({ name: "Sales", rows: [
      ["Date", "Customer", "Amount", "Channel", "Paid?", "Payment date"],
      ["2026-01-05", "Nile", 1000, "Online", "Yes", "2026-01-20"],
      ["2026-01-06", "Delta", 500, "Shop", "No", ""],
      ["2026-01-07", "Nile", 300, "Shop", "", "2026-01-09"],
    ] }, {}, simple)!;
    expect(r.lines.map((l) => [l.channel, l.paid, l.paidOn])).toEqual([["Online", true, "2026-01-20"], ["Shop", false, null], ["Shop", true, "2026-01-09"]]);
  });
  it("Arabic headings", () => {
    const r = readSalesGrid({ name: "المبيعات", rows: [["التاريخ", "العميل", "المبلغ", "طريقة البيع", "مدفوع"], ["2026-03-01", "النيل", 700, "متجر", "مدفوع"], ["2026-03-02", "الدلتا", 300, "أونلاين", "غير مدفوع"]] }, {}, simple)!;
    expect(r.lines.map((l) => [l.customer, l.amount, l.channel, l.paid])).toEqual([["النيل", 700, "متجر", true], ["الدلتا", 300, "أونلاين", false]]);
  });
  it("every row is read or its reason is kept: total row, blank amount, bad date", () => {
    const r = readSalesGrid({ name: "Sales", rows: [["Date", "Amount"], ["2026-01-05", 100], ["2026-01-06", ""], ["not a date", 50], ["Total", 150]] }, {}, simple)!;
    expect(r.lines).toHaveLength(1);
    const roles = r.layout.trace.filter(Boolean).map((m) => m!.role);
    expect(roles).toEqual(["header", "entry", "unused", "error", "total"]);
    expect(r.layout.errors[0].message).toContain("is not a date");
  });
});

describe("Simple mode: reading an Expenses sheet", () => {
  it("a date, an amount and a category are enough (no supplier needed)", () => {
    const r = readExpenseGrid({ name: "Expenses", rows: [["Date", "Category", "Amount"], ["05/01/2026", "Rent", 5000], ["06/01/2026", "Marketing", "1,200"]] }, {}, simple)!;
    expect(r.lines.map((l) => [l.day, l.category, l.amount, l.supplier])).toEqual([["2026-01-05", "Rent", 5000, "No supplier"], ["2026-01-06", "Marketing", 1200, "No supplier"]]);
  });
  it("Full mode still asks for a supplier (unchanged)", () => {
    expect(readExpenseGrid({ name: "Expenses", rows: [["Date", "Category", "Amount"], ["05/01/2026", "Rent", 5000]] })).toBeNull();
  });
  it("a fixed/variable column decides the cost class; paid/unpaid is read", () => {
    const r = readExpenseGrid({ name: "Expenses", rows: [
      ["Date", "Category", "Amount", "Fixed or variable", "Paid"],
      ["2026-01-05", "Rent", 5000, "Fixed", "yes"],
      ["2026-01-06", "Packaging", 800, "Variable", "no"],
      ["2026-01-07", "Salaries", 9000, "", ""],
    ] }, {}, simple)!;
    expect(r.lines.map((l) => [l.category, l.cls, l.paid])).toEqual([["Rent", "exp_fixed", true], ["Packaging", "exp_variable", false], ["Salaries", "exp_fixed", null]]);
  });
  it("a payment date beside the expense date is read as the payment date", () => {
    const r = readExpenseGrid({ name: "Expenses", rows: [["Date", "Category", "Amount", "Payment date"], ["2026-01-05", "Rent", 5000, "2026-02-01"]] }, {}, simple)!;
    expect(r.lines.map((l) => [l.day, l.paidOn, l.paid])).toEqual([["2026-01-05", "2026-02-01", true]]);
  });
  it("Arabic headings: ثابت / متغير", () => {
    const r = readExpenseGrid({ name: "المصروفات", rows: [["التاريخ", "البند", "المبلغ", "ثابت أو متغير"], ["2026-03-01", "إيجار", 4000, "ثابت"], ["2026-03-02", "شحن", 600, "متغير"]] }, {}, simple)!;
    expect(r.lines.map((l) => [l.category, l.amount, l.cls])).toEqual([["إيجار", 4000, "exp_fixed"], ["شحن", 600, "exp_variable"]]);
  });
});

describe("column choices remembered by heading", () => {
  it("a heading the reader doesn't know is read as the person chose last time", () => {
    const g = { name: "Sales", rows: [["When", "Takings"], ["2026-01-05", 1000]] };
    expect(readSalesGrid(g, {}, simple)).toBeNull();
    const r = readSalesGrid(g, { named: { when: "date", takings: "untaxed" } }, simple)!;
    expect(r.lines.map((l) => [l.day, l.amount])).toEqual([["2026-01-05", 1000]]);
  });
  it("expenses too; a choice made for this file's column still wins", () => {
    const g = { name: "Expenses", rows: [["Date", "Head", "Spent"], ["2026-01-05", "Rent", 500]] };
    const r = readExpenseGrid(g, { named: { head: "category", spent: "total" } }, simple)!;
    expect(r.lines.map((l) => [l.category, l.amount])).toEqual([["Rent", 500]]);
    expect(readExpenseGrid(g, { named: { head: "category", spent: "total" }, cols: { 1: "label" } }, simple)!.lines[0].category).toBe("Rent");
  });
});


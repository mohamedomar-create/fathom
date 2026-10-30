import { describe, expect, it } from "vitest";
import { readCashBook } from "@/lib/ingest/cashbook";
import { readBankStatement } from "@/lib/ingest/bank";

const sum = (ls: { amount: number }[]) => ls.reduce((a, l) => a + l.amount, 0);

// The full upload's cash book reader uses the cash book's kinds: owner's money, loans, transfers and drawings move cash
// but are not sales or costs.
describe("one cash reader: kinds in the full upload", () => {
  const rows = [["Date", "Description", "Money in", "Money out"],
    ["2026-03-01", "Counter sales", 400, null],
    ["2026-03-02", "Owner capital injection", 5000, null],
    ["2026-03-03", "Loan received from Banque Misr", 10000, null],
    ["2026-03-04", "Rent", null, 150],
    ["2026-03-05", "Owner drawings", null, 600],
    ["2026-03-06", "Deposit to bank", null, 2000],
    ["2026-03-07", "Loan repayment", null, 1000],
    ["2026-03-08", "New fridge", null, 3000],
    ["2026-03-09", "Capital Pharmacy", 250, null]];
  const r = readCashBook({ name: "Cash", rows: rows as never })!;
  it("only trading entries are sales and costs (a customer called Capital Pharmacy is still a sale)", () => {
    expect(sum(r.sales)).toBe(650);
    expect(sum(r.expenses)).toBe(150);
  });
  it("lists what it held back, with the kind and the amount", () => {
    const held = r.layout.heldBack ?? [];
    expect(held.map((h) => [h.kind, h.amount])).toEqual([["capital", 5000], ["loan", 10000], ["drawings", 600], ["transfer", 2000], ["loan_repayment", 1000], ["asset", 3000]]);
    expect(r.layout.checks.map((c) => c.message).join(" ")).toMatch(/not counted as sales or costs/);
  });
});

describe("a bank statement counted as sales or costs leaves out non-trading lines", () => {
  const g = { name: "Bank", rows: [["Date", "Description", "Debit", "Credit", "Balance"],
    [null, "Opening balance", null, null, 1000],
    ["2026-03-02", "Card sales settlement", null, 500, 1500],
    ["2026-03-03", "Loan received", null, 10000, 11500],
    ["2026-03-04", "Rent March", 300, null, 11200],
    ["2026-03-05", "Owner drawings", 700, null, 10500]] } as never;
  it("money in as sales without the loan; money out as costs without the drawings", () => {
    const r = readBankStatement(g, { inAsSales: true, outAsExpenses: true })!;
    expect(sum(r.sales)).toBe(500);
    expect(sum(r.expenses)).toBe(300);
    expect((r.layout.heldBack ?? []).map((h) => h.kind)).toEqual(["loan", "drawings"]);
  });
});

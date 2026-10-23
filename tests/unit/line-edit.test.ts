import { describe, expect, it } from "vitest";
import { LineEdit, NewLine } from "@/lib/company/line-edit";

describe("a line typed into the app", () => {
  it("a new sale needs a date and an amount; the rest is optional", () => {
    expect(NewLine.safeParse({ kind: "sales", line: { day: "2026-03-04", amount: 1200 } }).success).toBe(true);
    expect(NewLine.safeParse({ kind: "sales", line: { amount: 1200 } }).success).toBe(false);
    expect(NewLine.safeParse({ kind: "sales", line: { day: "2026-03-04" } }).success).toBe(false);
    expect(NewLine.safeParse({ kind: "sales", line: { day: "4/3/2026", amount: 1 } }).success).toBe(false);
  });
  it("a new expense also needs its category", () => {
    expect(NewLine.safeParse({ kind: "expenses", line: { day: "2026-03-04", amount: 300, category: "Rent" } }).success).toBe(true);
    expect(NewLine.safeParse({ kind: "expenses", line: { day: "2026-03-04", amount: 300 } }).success).toBe(false);
    expect(NewLine.safeParse({ kind: "expenses", line: { day: "2026-03-04", amount: 300, category: " " } }).success).toBe(false);
  });
  it("only fixed or variable is accepted as an expense's kind", () => {
    expect(NewLine.safeParse({ kind: "expenses", line: { day: "2026-03-04", amount: 1, category: "Rent", cls: "exp_fixed" } }).success).toBe(true);
    expect(NewLine.safeParse({ kind: "expenses", line: { day: "2026-03-04", amount: 1, category: "Rent", cls: "revenue" } }).success).toBe(false);
  });
  it("a change names the line by id and may leave the amount out, never blank it", () => {
    expect(LineEdit.safeParse({ kind: "sales", id: 5, line: { customer: "A" } }).success).toBe(true);
    expect(LineEdit.safeParse({ kind: "sales", id: 5, line: { amount: null } }).success).toBe(false);
    expect(LineEdit.safeParse({ kind: "sales", id: -1, line: {} }).success).toBe(false);
    expect(LineEdit.safeParse({ kind: "other", id: 5, line: {} }).success).toBe(false);
  });
  it("a payment date is a date; paid is yes, no or blank", () => {
    expect(NewLine.safeParse({ kind: "sales", line: { day: "2026-03-04", amount: 1, paid: true, paidOn: "2026-03-10" } }).success).toBe(true);
    expect(NewLine.safeParse({ kind: "sales", line: { day: "2026-03-04", amount: 1, paid: "yes" } }).success).toBe(false);
  });
});

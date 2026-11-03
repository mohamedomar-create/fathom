import { describe, expect, it } from "vitest";
import { builderBases, latestMonth, partOf, startRows, versionRows } from "@/lib/engine/budget-bases";
import { RowSchema } from "@/lib/company/budget-schema";
import { budgetToLines, storedRow, type BudgetRow, type BudgetSetup } from "@/lib/engine/budget-builder";
import { fyMonths } from "@/lib/engine/budget";
import type { SalesCustomerRow, SalesProductRow } from "@/lib/engine/sales";
import type { ExpenseAccountRow } from "@/lib/engine/expenses";

const pr = (p: string, r: string, a: number, q: number | null = null, k: number | null = null): SalesProductRow => ({ p, r, g: "G", s: "S", a, k, ka: k === null ? null : a, q, n: 1 });
const cr = (p: string, c: string, a: number): SalesCustomerRow => ({ p, c, s: "S", sp: "", a, k: null, ka: null, q: null, d: 0, n: 1 });
const er = (p: string, t: string, a: number, c: ExpenseAccountRow["c"] = null): ExpenseAccountRow => ({ p, t, g: "", c, a, n: 1 });
const setup: BudgetSetup = {
  products: ["A"], groups: [{ id: "g1", name: "Group one", products: ["B"], customers: [] }], streams: { rental: ["A"] },
  expenses: { merged: [{ id: "m1", name: "Premises", accounts: ["610 Rent", "620 Power"] }], excluded: ["690 Odd"] },
};
const products = [pr("2026-01", "A", 100, 2, 60), pr("2026-02", "A", 300, 6, 180), pr("2026-01", "B", 50), pr("2026-02", "C", 10)];
const customers = [cr("2026-01", "X", 120), cr("2026-02", "X", 200), cr("2026-01", "Y", 30), cr("2026-02", "Y", 110)];
const expenses = [er("2026-01", "610 Rent", 40, "exp_fixed"), er("2026-02", "620 Power", 10, "exp_variable"), er("2026-03", "690 Odd", 5), er("2026-02", "700 Fees", 7)];

describe("builder bases", () => {
  it("latest month across sales and expenses", () => {
    expect(latestMonth({ products, customers, expenses })).toBe("2026-03");
    expect(latestMonth({ products: [], customers: [], expenses: [] })).toBeNull();
  });

  it("revenue items, customers and expenses as base rows for the budget year", () => {
    const b = builderBases({ products, customers, expenses }, setup, "2027", 1);
    expect(b.asOf).toBe("2026-03");
    expect(b.revenue.map((r) => r.key)).toEqual(["prod:A", "grp:g1", "others"]);
    const a = b.revenue[0];
    expect(a.label).toBe("A");
    expect(a.estimate).toBe(400);
    expect(a.price).toBe(50); // 400 / 8 units
    expect(a.units).toBe(8);
    expect(a.unitCost).toBeNull(); // no stock cost-of-goods rows to replace: revenue rows budget no cost
    expect(b.revenue[1].label).toBe("Group one");
    expect(b.revenue[1].price).toBeUndefined(); // no quantities
    expect(b.customer.map((c) => c.key)).toEqual(["cust:X", "cust:Y"]);
    // Merged accounts are one row (class of the largest member); excluded accounts are left out.
    expect(b.expense.map((e) => [e.key, e.cls])).toEqual([["expgrp:m1", "exp_fixed"], ["exp:700 Fees", "exp_fixed"]]);
    expect(b.expense[0].label).toBe("Premises");
    expect(b.members.get("grp:g1")).toEqual([{ product: "B", estimate: 50 }]);
  });

  const withCogs = [...expenses, er("2026-01", "500 COGS", 70, "cos_variable"), er("2026-02", "510 Freight in", 9, "cos_variable")];
  const stockCogs = ["500 COGS"];
  const keys = (b: ReturnType<typeof builderBases>) => b.expense.map((e) => e.key);

  it("cost of sales: an item without a unit cost means nothing is left out and no revenue row budgets cost", () => {
    // A and B have no quantities (B) -> not every item with an estimate has a unit cost.
    const b = builderBases({ products, customers, expenses: withCogs, stockCogs }, setup, "2027", 1);
    expect(keys(b)).toEqual(expect.arrayContaining(["exp:500 COGS", "exp:510 Freight in"]));
    expect(b.excluded).toEqual([]);
    expect(b.revenue.every((r) => r.unitCost == null)).toBe(true);
    expect(b.revenue.find((r) => r.key === "prod:A")!.price).toBe(50); // units × price still offered
  });

  it("cost of sales: every item with a unit cost leaves out only the stock cost-of-goods rows", () => {
    const costed = [pr("2026-01", "A", 100, 2, 60), pr("2026-02", "A", 300, 6, 180), pr("2026-01", "B", 50, 5, 20), pr("2026-02", "C", 10, 1, 4)];
    const b = builderBases({ products: costed, customers, expenses: withCogs, stockCogs }, setup, "2027", 1);
    expect(keys(b)).not.toContain("exp:500 COGS");
    expect(keys(b)).toContain("exp:510 Freight in");
    expect(b.excluded).toEqual(["500 COGS"]);
    expect(b.revenue.find((r) => r.key === "prod:A")!.unitCost).toBe(30);
    // No stock cost-of-goods rows: nothing to leave out, so the revenue rows budget no cost (no double counting).
    const none = builderBases({ products: costed, customers, expenses: withCogs }, setup, "2027", 1);
    expect(keys(none)).toContain("exp:500 COGS");
    expect(none.excluded).toEqual([]);
    expect(none.revenue.every((r) => r.unitCost == null)).toBe(true);
  });

  it("start rows equal this year's estimate and their lines add up to them", () => {
    const b = builderBases({ products, customers, expenses }, setup, "2027", 1);
    const rows = startRows(b);
    const sum = (m: number[]) => Math.round(m.reduce((t, v) => t + v, 0) * 100) / 100;
    for (const r of rows.filter((x) => x.view !== "customer")) {
      const base = [...b.revenue, ...b.expense].find((x) => x.key === r.key)!;
      expect(r.basis).toEqual({ kind: "pct", value: 0 });
      expect(sum(r.months)).toBe(base.estimate);
    }
    const rev = rows.filter((r) => r.view === "revenue").reduce((t, r) => t + sum(r.months), 0);
    const cust = rows.filter((r) => r.view === "customer");
    expect(cust.every((c) => c.basis === null)).toBe(true);
    expect(cust.reduce((t, r) => t + sum(r.months), 0)).toBeCloseTo(rev, 2);
    expect(rows.find((r) => r.key === "exp:700 Fees")!.cls).toBe("exp_fixed");
    const lines = budgetToLines(rows, fyMonths("2027", 1));
    expect(lines.filter((l) => l.key === "cls:revenue").reduce((t, l) => t + l.amount, 0)).toBeCloseTo(rev, 2);
  });

  it("part of the as-of month booked", () => {
    expect(partOf("2026-03-15", "2026-03")).toBeCloseTo(15 / 31, 10);
    expect(partOf("2026-02-28", "2026-02")).toBe(1);
    expect(partOf(undefined, "2026-03")).toBe(1);
    expect(partOf("2026-02-10", "2026-03")).toBe(1);
  });
});

describe("cost of sales is fixed in the version", () => {
  const withCogs = [...expenses, er("2026-01", "500 COGS", 70, "cos_variable"), er("2026-02", "510 Freight in", 9, "cos_variable")];
  const stockCogs = ["500 COGS"];
  const costed = [pr("2026-01", "A", 100, 2, 60), pr("2026-02", "A", 300, 6, 180), pr("2026-01", "B", 50, 5, 20), pr("2026-02", "C", 10, 1, 4)];
  const months = fyMonths("2027", 1);
  const tot = (rows: BudgetRow[], key: string) => Math.round(budgetToLines(rows, months).filter((l) => l.key === key).reduce((t, l) => t + l.amount, 0) * 100) / 100;
  const all = (v: ReturnType<typeof versionRows>) => [...v.revenue, ...v.customer, ...v.expense];

  it("a version built with unit costs keeps its cost after the live data loses one item's cost", () => {
    const b1 = builderBases({ products: costed, customers, expenses: withCogs, stockCogs }, setup, "2027", 1);
    expect(b1.byUnitCost).toBe(true);
    const rows = startRows(b1);
    expect(rows.find((r) => r.key === "prod:A")!.cost).toEqual({ kind: "unit", value: 30, price: 50 });
    expect(rows.some((r) => r.key === "exp:500 COGS")).toBe(false);
    const cos = tot(rows, "cls:cos_variable");
    expect(cos).toBeGreaterThan(0);
    // A later sale of B without a cost: the live data would no longer budget by unit cost.
    const b2 = builderBases({ products: [...costed, pr("2026-03", "B", 40, 2, null)], customers, expenses: withCogs, stockCogs }, setup, "2027", 1);
    expect(b2.byUnitCost).toBe(false);
    const again = versionRows(rows, b2);
    expect(again.expense.map((r) => r.key)).not.toContain("exp:500 COGS");
    expect(again.revenue.find((r) => r.key === "prod:A")!.cost).toEqual({ kind: "unit", value: 30, price: 50 });
    expect(tot(all(again), "cls:cos_variable")).toBe(cos);
  });

  it("an item with a known cost but no quantities budgets its cost by margin", () => {
    const mixedQ = [pr("2026-01", "A", 100, 2, 60), pr("2026-02", "A", 300, 6, 180), pr("2026-01", "B", 50, null, 20), pr("2026-02", "C", 10, 1, 4)];
    const b = builderBases({ products: mixedQ, customers, expenses: withCogs, stockCogs }, setup, "2027", 1);
    expect(b.byUnitCost).toBe(true);
    const rows = startRows(b);
    expect(rows.find((r) => r.key === "grp:g1")!.cost).toEqual({ kind: "margin", pct: 60 });
    expect(rows.find((r) => r.key === "prod:A")!.cost).toEqual({ kind: "unit", value: 30, price: 50 });
  });

  it("a version built without unit costs never gains them", () => {
    const b1 = builderBases({ products, customers, expenses: withCogs, stockCogs }, setup, "2027", 1);
    expect(b1.byUnitCost).toBe(false);
    const rows = startRows(b1);
    expect(rows.filter((r) => r.view === "revenue").every((r) => r.cost === null)).toBe(true);
    const b2 = builderBases({ products: costed, customers, expenses: withCogs, stockCogs }, setup, "2027", 1);
    expect(b2.byUnitCost).toBe(true);
    const again = versionRows(rows, b2);
    expect(again.revenue.every((r) => r.cost === null)).toBe(true);
    expect(again.expense.map((r) => r.key)).toContain("exp:500 COGS");
    // Cost of sales is the stock account only (70 this year), never the account and a unit cost on top.
    expect(tot(all(again), "cls:cos_variable")).toBe(0);
    expect(tot(all(again), "#500")).toBe(70);
  });

  it("a new version with no saved rows starts from the setup", () => {
    const b = builderBases({ products: costed, customers, expenses: withCogs, stockCogs }, setup, "2027", 1);
    const v = versionRows([], b);
    expect(v.revenue.map((r) => r.key)).toEqual(b.revenue.map((r) => r.key));
    expect(v.expense.map((r) => r.key)).not.toContain("exp:500 COGS");
  });

  it("expense rows round-trip their class", () => {
    const b = builderBases({ products, customers, expenses: withCogs, stockCogs }, setup, "2027", 1);
    const exp = startRows(b).filter((r) => r.view === "expense");
    expect(exp.find((r) => r.key === "exp:500 COGS")!.cost).toEqual({ kind: "expense", cls: "cos_variable" });
    for (const r of exp) {
      const parsed = RowSchema.parse(JSON.parse(JSON.stringify(r)));
      // What the database keeps: the row without cls (there is no column), the class inside cost.
      const { cls: _drop, ...db } = parsed;
      void _drop;
      expect(storedRow(db).cls).toBe(r.cls);
    }
  });

  it("a cost-of-sales account mixing stock cost of goods with other lines means no unit cost", () => {
    const b = builderBases({ products: costed, customers, expenses: withCogs, stockCogs, mixedCogs: ["510 Freight in"] }, setup, "2027", 1);
    expect(b.byUnitCost).toBe(false);
    expect(b.excluded).toEqual([]);
    expect(b.revenue.every((r) => r.unitCost == null)).toBe(true);
    expect(b.expense.map((e) => e.key)).toContain("exp:500 COGS");
    expect(startRows(b).filter((r) => r.view === "revenue").every((r) => r.cost === null)).toBe(true);
  });
});

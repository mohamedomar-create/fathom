import { describe, expect, it } from "vitest";
import { builderBases, latestMonth, startRows } from "@/lib/engine/budget-bases";
import { budgetToLines, type BudgetSetup } from "@/lib/engine/budget-builder";
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
    const lines = budgetToLines(rows, b.byKey, fyMonths("2027", 1));
    expect(lines.filter((l) => l.key === "cls:revenue").reduce((t, l) => t + l.amount, 0)).toBeCloseTo(rev, 2);
  });
});

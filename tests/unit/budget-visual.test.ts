import { describe, expect, it } from "vitest";
import { budgetTotals, changeBadge, sortRows } from "@/lib/engine/budget-visual";

describe("change badge", () => {
  it("income up is good, down is bad", () => {
    expect(changeBadge(110, 100)).toEqual({ dir: "up", tone: "good", pct: 10 });
    expect(changeBadge(90, 100)).toEqual({ dir: "down", tone: "bad", pct: -10 });
  });
  it("an expense increase is bad, a decrease good", () => {
    expect(changeBadge(110, 100, true)).toEqual({ dir: "up", tone: "bad", pct: 10 });
    expect(changeBadge(80, 100, true)).toEqual({ dir: "down", tone: "good", pct: -20 });
  });
  it("no change or nothing to compare with is neutral", () => {
    expect(changeBadge(100, 100)).toEqual({ dir: "flat", tone: "neutral", pct: 0 });
    expect(changeBadge(100, 0)).toEqual({ dir: "flat", tone: "neutral", pct: null });
    expect(changeBadge(100.2, 100)).toEqual({ dir: "flat", tone: "neutral", pct: 0.2 });
  });
  it("a negative base (a loss) is compared on its size", () => {
    expect(changeBadge(-50, -100)).toEqual({ dir: "up", tone: "good", pct: 50 });
  });
});

describe("sort rows", () => {
  const rows = [
    { key: "b", name: "Beta", amount: 200, change: 5 },
    { key: "a", name: "alpha", amount: 900, change: null },
    { key: "c", name: "Gamma", amount: 50, change: 40 },
  ];
  const v = { name: (r: (typeof rows)[number]) => r.name, amount: (r: (typeof rows)[number]) => r.amount, change: (r: (typeof rows)[number]) => r.change };
  it("keeps the order with no sort", () => {
    expect(sortRows(rows, null, v).map((r) => r.key)).toEqual(["b", "a", "c"]);
  });
  it("name A to Z (case-insensitive), then Z to A", () => {
    expect(sortRows(rows, { by: "name", desc: false }, v).map((r) => r.key)).toEqual(["a", "b", "c"]);
    expect(sortRows(rows, { by: "name", desc: true }, v).map((r) => r.key)).toEqual(["c", "b", "a"]);
  });
  it("amount largest first; change largest first with no change last", () => {
    expect(sortRows(rows, { by: "amount", desc: true }, v).map((r) => r.key)).toEqual(["a", "b", "c"]);
    expect(sortRows(rows, { by: "amount", desc: false }, v).map((r) => r.key)).toEqual(["c", "b", "a"]);
    expect(sortRows(rows, { by: "change", desc: true }, v).map((r) => r.key)).toEqual(["c", "b", "a"]);
    expect(sortRows(rows, { by: "change", desc: false }, v).map((r) => r.key)).toEqual(["b", "c", "a"]);
  });
  it("does not change the list it is given", () => {
    sortRows(rows, { by: "amount", desc: true }, v);
    expect(rows[0].key).toBe("b");
  });
});

describe("budget totals (the cards)", () => {
  const l = (cls: string, amount: number) => ({ key: cls, cls, label: null, month: "2026-01", amount }) as never;
  it("revenue, gross profit, the costs below it net of other income, net profit", () => {
    expect(budgetTotals([l("revenue", 1000), l("cos_variable", 400), l("exp_fixed", 200), l("tax_expenses", 50), l("other_income", 30)]))
      .toEqual({ revenue: 1000, gp: 600, exp: 220, np: 380 });
  });
  it("leaves out balance-sheet accounts (stock bought into stock interim) and other non-costs", () => {
    expect(budgetTotals([l("revenue", 1000), l("cos_variable", 400), l("other_cl", 900), l("dividends", 70)]))
      .toEqual({ revenue: 1000, gp: 600, exp: 0, np: 600 });
  });
});

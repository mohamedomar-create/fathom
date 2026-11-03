import { describe, expect, it } from "vitest";
import {
  baseYears, expenseSeries, itemOf, productSeries, revenueItems, spread, customerSeries,
  type BudgetSetup,
} from "@/lib/engine/budget-builder";
import type { SalesProductRow, SalesCustomerRow } from "@/lib/engine/sales";
import type { ExpenseAccountRow } from "@/lib/engine/expenses";

const mk = (year: number, f: (m: number) => number, from = 1, to = 12) => {
  const m = new Map<string, number>();
  for (let i = from; i <= to; i++) m.set(`${year}-${String(i).padStart(2, "0")}`, f(i));
  return m;
};
const merge = (...maps: Map<string, number>[]) => new Map(maps.flatMap((m) => [...m]));
const pr = (p: string, r: string, a: number): SalesProductRow => ({ p, r, g: "G", s: "S", a, k: null, ka: null, q: null, n: 1 });
const setupOf = (over: Partial<BudgetSetup> = {}): BudgetSetup => ({
  products: [], groups: [], streams: { rental: [] }, expenses: { merged: [], excluded: [] }, ...over,
});

describe("budget builder: base columns", () => {
  it("base-years", () => {
    // budget year 2027, calendar financial year; this year = 2026, as of 15 Mar 2026
    const s = new Map([["x", merge(mk(2023, () => 100), mk(2025, () => 200), mk(2026, () => 220, 1, 3))]]);
    const b = baseYears(s, "2027", 1, "2026-03-15");
    expect(b.years).toEqual([{ fy: "2023", amount: 1200 }, { fy: "2025", amount: 2400 }]);
    expect(b.ytd).toBe(660);
    expect(b.months).toHaveLength(12);
    expect(b.months.slice(0, 3)).toEqual([220, 220, 220]);
    expect(b.lastYear).toEqual(Array(12).fill(200));
    expect(b.estimate).toBe(660 + 9 * 220);
  });

  it("estimate-ratio", () => {
    const s = new Map([["x", merge(mk(2025, (m) => 100 * m), mk(2026, (m) => 110 * m, 1, 2))]]);
    const b = baseYears(s, "2027", 1, "2026-02");
    // ytd 110+220=330 vs last year 100+200=300 -> ratio 1.1
    expect(b.ytd).toBe(330);
    expect(b.months[2]).toBe(330);
    expect(b.months[11]).toBe(1320);
    expect(b.estimate).toBe(330 + [300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200].reduce((t, v) => t + Math.round(v * 1.1 * 100) / 100, 0));
    // no comparable last year -> last year's month as-is
    const t = new Map([["x", merge(mk(2025, () => 0, 1, 2), mk(2025, () => 50, 3, 12), mk(2026, () => 10, 1, 2))]]);
    const c = baseYears(t, "2027", 1, "2026-02");
    expect(c.months[5]).toBe(50);
  });

  it("top-n-and-others", () => {
    const rows = [pr("2026-01", "A", 500), pr("2026-01", "B", 300), pr("2026-01", "C", 20), pr("2026-01", "D", 5), pr("2026-02", "C", 7)];
    const items = revenueItems(rows, setupOf({ products: ["A", "B"] }));
    expect([...items.keys()].sort()).toEqual(["others", "prod:A", "prod:B"]);
    expect(items.get("prod:A")!.get("2026-01")).toBe(500);
    expect(items.get("others")!.get("2026-01")).toBe(25);
    expect(items.get("others")!.get("2026-02")).toBe(7);
  });

  it("group-membership", () => {
    const setup = setupOf({ products: ["A"], groups: [{ id: "g1", name: "Gear", products: ["B", "C"], customers: [] }, { id: "g2", name: "Two", products: ["C", "D"], customers: [] }] });
    expect(itemOf("A", setup)).toBe("prod:A");
    expect(itemOf("B", setup)).toBe("grp:g1");
    expect(itemOf("C", setup)).toBe("grp:g1"); // first group wins
    expect(itemOf("D", setup)).toBe("grp:g2");
    expect(itemOf("Z", setup)).toBe("others");
    const items = revenueItems([pr("2026-01", "B", 10), pr("2026-01", "C", 5), pr("2026-01", "D", 1)], setup);
    expect(items.get("grp:g1")!.get("2026-01")).toBe(15);
    expect(items.get("grp:g2")!.get("2026-01")).toBe(1);
  });

  it("standalone-wins", () => {
    const setup = setupOf({ products: ["A"], groups: [{ id: "g1", name: "G", products: ["A", "B"], customers: [] }] });
    expect(itemOf("A", setup)).toBe("prod:A");
    const items = revenueItems([pr("2026-01", "A", 40), pr("2026-01", "B", 2)], setup);
    expect(items.get("prod:A")!.get("2026-01")).toBe(40);
    expect(items.get("grp:g1")!.get("2026-01")).toBe(2);
    const total = [...items.values()].reduce((t, m) => t + (m.get("2026-01") ?? 0), 0);
    expect(total).toBe(42);
  });

  it("others-only", () => {
    const items = revenueItems([pr("2026-01", "No product", 30), pr("2026-02", "No product", 12)], setupOf());
    expect([...items.keys()]).toEqual(["others"]);
    expect(items.get("others")!.get("2026-02")).toBe(12);
    const ps = productSeries([pr("2026-01", "P", 3), pr("2026-01", "P", 4)]);
    expect(ps.get("P")!.get("2026-01")).toBe(7);
    const c: SalesCustomerRow = { p: "2026-01", c: "Cu", s: "S", sp: "", a: 9, k: null, ka: null, q: null, d: 0, n: 1 };
    expect(customerSeries([c, c]).get("Cu")!.get("2026-01")).toBe(18);
  });

  it("expenses-merged-excluded", () => {
    const e = (p: string, t: string, a: number): ExpenseAccountRow => ({ p, t, g: "G", c: null, a, n: 1 });
    const setup = setupOf({ expenses: { merged: [{ id: "m1", name: "Utilities", accounts: ["Power", "Water"] }], excluded: ["Tax"] } });
    const s = expenseSeries([e("2026-01", "Power", 10), e("2026-01", "Water", 5), e("2026-02", "Water", 2), e("2026-01", "Tax", 99), e("2026-01", "Rent", 70)], setup);
    expect([...s.keys()].sort()).toEqual(["exp:Rent", "expgrp:m1"]);
    expect(s.get("expgrp:m1")!.get("2026-01")).toBe(15);
    expect(s.get("expgrp:m1")!.get("2026-02")).toBe(2);
    expect(s.get("exp:Rent")!.get("2026-01")).toBe(70);
  });
});

describe("budget builder: spread", () => {
  it("spread-exact", () => {
    const out = spread(1000, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(out).toHaveLength(12);
    expect(Math.round(out.reduce((t, v) => t + v, 0) * 100)).toBe(100000);
    expect(out[0]).toBe(83.33);
    expect(out[11]).toBe(83.37);
    const w = spread(100, [3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(w.slice(0, 2)).toEqual([75, 25]);
    expect(w[11]).toBe(0);
    const neg = spread(-100, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(Math.round(neg.reduce((t, v) => t + v, 0) * 100)).toBe(-10000);
    expect(spread(0, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).every((v) => v === 0)).toBe(true);
  });

  it("spread-fallbacks", () => {
    const zero = Array(12).fill(0);
    const fb = [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2];
    expect(spread(100, zero, fb)[0]).toBe(50);
    expect(spread(100, zero, fb)[11]).toBe(50);
    expect(spread(100, zero, fb)[5]).toBe(0);
    expect(spread(120, zero, zero)).toEqual(Array(12).fill(10));
    expect(spread(120, zero)).toEqual(Array(12).fill(10));
  });
});

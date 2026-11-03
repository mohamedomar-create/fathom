import { describe, expect, it } from "vitest";
import {
  baseYears, expenseSeries, itemOf, productSeries, revenueItems, spread, customerSeries,
  rowMonths, costMonths, customerView, balanceCustomers, streamView, groupView, budgetToLines, actualByItem,
  type BudgetSetup, type BaseCol, type BudgetRow,
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

const base = (key: string, over: Partial<BaseCol> = {}): BaseCol => ({
  key, label: key, years: [], ytd: 0, estimate: 1200, months: Array(12).fill(100), lastYear: Array(12).fill(100), ...over,
});
const row = (over: Partial<BudgetRow> & { key: string }): BudgetRow => ({
  view: "revenue", label: over.key, mode: "year", basis: null, cost: null, months: Array(12).fill(0), ...over,
});
const MONTHS = Array.from({ length: 12 }, (_, i) => `2027-${String(i + 1).padStart(2, "0")}`);
const sum = (a: number[]) => Math.round(a.reduce((t, v) => t + v, 0) * 100) / 100;

describe("budget builder: fixes to base and spread", () => {
  it("actual-months-rounded", () => {
    const s = new Map([["x", merge(mk(2025, () => 10), mk(2026, () => 10.005, 1, 2))]]);
    const b = baseYears(s, "2027", 1, "2026-02");
    expect(b.months[0]).toBe(10.01);
    expect(b.months[1]).toBe(10.01);
    expect(sum(b.months)).toBe(b.estimate);
    const t = new Map([["x", mk(2025, (m) => m + 0.004)]]);
    expect(baseYears(t, "2027", 1, "2026-01").lastYear[0]).toBe(1);
  });

  it("spread-no-negative-zero", () => {
    const out = spread(-100, [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(out.some((v) => Object.is(v, -0))).toBe(false);
    expect(out[1]).toBe(0);
    expect(out[0]).toBe(-100);
  });
});

describe("budget builder: row months", () => {
  const b = base("prod:a", { estimate: 1200, lastYear: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 0, 200] });
  it("amount-basis", () => {
    const m = rowMonths({ kind: "amount", value: 1200 }, b);
    expect(m[0]).toBe(100);
    expect(m[10]).toBe(0);
    expect(m[11]).toBe(200);
    expect(sum(m)).toBe(1200);
  });
  it("pct-basis", () => {
    const m = rowMonths({ kind: "pct", value: 10 }, b);
    expect(sum(m)).toBe(1320);
    expect(m[0]).toBe(110);
    expect(m[11]).toBe(220);
  });
  it("units-basis", () => {
    const m = rowMonths({ kind: "units", units: 50, price: 24 }, b);
    expect(sum(m)).toBe(1200);
    expect(m[0]).toBe(100);
  });
  it("months-mode", () => {
    const typed = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const r = row({ key: "prod:a", mode: "months", basis: { kind: "amount", value: 999 }, months: typed });
    expect(r.months).toEqual(typed);
    expect(budgetToLines([r], new Map(), MONTHS).map((l) => l.amount)).toEqual(typed);
  });
});

describe("budget builder: cost of sales", () => {
  const b = base("prod:a", { price: 20, unitCost: 8 });
  const r = (cost: BudgetRow["cost"], basis: BudgetRow["basis"] = { kind: "units", units: 60, price: 20 }) =>
    row({ key: "prod:a", basis, cost, months: Array(12).fill(100) });
  it("cost-unit", () => {
    // 100 per month at price 20 = 5 units x 7.5
    expect(costMonths(r({ kind: "unit", value: 7.5 }), b)).toEqual(Array(12).fill(37.5));
    // unit without a units basis falls back to the default (unitCost/price = 0.4)
    expect(costMonths(r({ kind: "unit", value: 7.5 }, { kind: "amount", value: 1200 }), b)).toEqual(Array(12).fill(40));
  });
  it("cost-margin", () => {
    expect(costMonths(r({ kind: "margin", pct: 70 }), b)).toEqual(Array(12).fill(30));
  });
  it("cost-default-last-year", () => {
    expect(costMonths(r(null), b)).toEqual(Array(12).fill(40));
    expect(costMonths(r(null), base("prod:a"))).toEqual(Array(12).fill(0));
  });
});

describe("budget builder: customer view", () => {
  const cs = [base("A", { estimate: 600 }), base("B", { estimate: 300 }), base("C", { estimate: 100 })];
  const rev = Array(12).fill(1000);
  it("customer-shares", () => {
    const v = customerView(rev, cs, []);
    expect(v.rows.map((x) => x.months[0])).toEqual([600, 300, 100]);
    expect(v.difference).toEqual(Array(12).fill(0));
    const odd = customerView(Array(12).fill(100), [base("A", { estimate: 1 }), base("B", { estimate: 1 }), base("C", { estimate: 1 })], []);
    expect(odd.difference).toEqual(Array(12).fill(0));
    expect(odd.rows.every((x) => x.view === "customer")).toBe(true);
    expect(sum(odd.rows.map((x) => x.months[0]))).toBe(100);
  });
  it("customer-edit-difference", () => {
    const edited = [row({ view: "customer", key: "A", months: Array(12).fill(500) })];
    const v = customerView(rev, cs, edited);
    expect(v.rows[0].months[0]).toBe(500);
    expect(v.rows[1].months[0]).toBe(300);
    expect(v.difference[0]).toBe(100);
    const b = balanceCustomers(v, new Set(["A"]));
    expect(b.map((x) => x.months[0])).toEqual([500, 375, 125]);
  });
  it("balance-floor", () => {
    const edited = [row({ view: "customer", key: "A", months: Array(12).fill(1200) })];
    const v = customerView(rev, cs, edited);
    expect(v.difference[0]).toBe(-600);
    const b = balanceCustomers(v, new Set(["A"]));
    expect(b[1].months[0]).toBe(0);
    expect(b[2].months[0]).toBe(0);
    expect(b[0].months[0]).toBe(1200);
    const left = rev[0] - sum(b.map((x) => x.months[0]));
    expect(left).toBe(-200);
  });
});

describe("budget builder: stream and group views", () => {
  const setup = setupOf({ streams: { rental: ["R"] } });
  it("stream-split", () => {
    const g = row({ key: "grp:1", months: Array(12).fill(100) });
    const p = row({ key: "prod:S", months: Array(12).fill(50) });
    const members = new Map([["grp:1", [{ product: "R", estimate: 300 }, { product: "T", estimate: 900 }]]]);
    const v = streamView([g, p], setup, members);
    expect(v.rental).toEqual(Array(12).fill(25));
    expect(v.sales).toEqual(Array(12).fill(125));
    expect(streamView([row({ key: "prod:R", months: Array(12).fill(10) })], setup, new Map()).rental[0]).toBe(10);
  });
  it("group-view-sum", () => {
    const s = setupOf({ products: ["P"], groups: [{ id: "1", name: "One", products: ["X"], customers: [] }, { id: "2", name: "Two", products: [], customers: ["Cu"] }] });
    const revenue = [
      row({ key: "grp:1", months: Array(12).fill(100) }), row({ key: "prod:P", months: Array(12).fill(40) }),
      row({ key: "others", months: Array(12).fill(10) }),
    ];
    const g = groupView(revenue, [], s);
    expect(g.map((x) => x.id)).toEqual(["1", "2", "others"]);
    expect(g[0].months[0]).toBe(100);
    expect(g[1].months[0]).toBe(0);
    expect(g[2].months[0]).toBe(50);
    expect(sum(g.map((x) => x.months[0]))).toBe(150);
    // Customer rows are keyed "cust:<name>"; the setup lists bare customer names.
    const cust = [row({ view: "customer", key: "cust:Cu", months: Array(12).fill(7) }), row({ view: "customer", key: "cust:Other", months: Array(12).fill(3) })];
    const gv = groupView(revenue, cust, s);
    expect(gv[1]).toMatchObject({ by: "customers", months: Array(12).fill(7) });
    expect(gv[0].by).toBe("products");
    for (let i = 0; i < 12; i++) expect(sum(gv.filter((x) => x.by === "products").map((x) => x.months[i]))).toBe(150);
    expect(gv[2].months[0]).toBe(50);
    const s2 = setupOf({ products: ["P"], groups: [{ id: "1", name: "One", products: ["P"], customers: [] }] });
    expect(groupView(revenue, [], s2)[0].months[0]).toBe(140);
  });
});

describe("budget builder: group first match", () => {
  it("group-view-first-match", () => {
    const s = setupOf({ products: ["P"], groups: [{ id: "1", name: "One", products: ["P"], customers: [] }, { id: "2", name: "Two", products: ["P"], customers: [] }] });
    const revenue = [row({ key: "prod:P", months: Array(12).fill(40) }), row({ key: "others", months: Array(12).fill(5) })];
    const g = groupView(revenue, [], s);
    expect(g.map((x) => x.months[0])).toEqual([40, 0, 5]);
    expect(sum(g.map((x) => x.months[0]))).toBe(45);
  });
});

describe("budget builder: lines and actuals", () => {
  it("lines-total", () => {
    const rev = row({ key: "prod:a", basis: { kind: "amount", value: 1200 }, cost: { kind: "margin", pct: 60 }, months: Array(12).fill(100) });
    rev.months[3] = 0;
    const e1 = row({ view: "expense", key: "exp:522021 Installation", label: "522021 Installation", cls: "exp_variable", months: Array(12).fill(5) });
    const e2 = row({ view: "expense", key: "exp:Petty cash", label: "Petty cash", months: Array(12).fill(2) });
    const e3 = row({ view: "expense", key: "expgrp:7", label: "Rent & Co", cls: "exp_fixed", months: Array(12).fill(3) });
    const cust = row({ view: "customer", key: "A", months: Array(12).fill(100) });
    const lines = budgetToLines([rev, e1, e2, e3, cust], new Map([["prod:a", base("prod:a")]]), MONTHS);
    const tot = (k: string) => sum(lines.filter((l) => l.key === k).map((l) => l.amount));
    expect(tot("cls:revenue")).toBe(1100);
    expect(tot("cls:cos_variable")).toBe(440);
    expect(tot("#522021")).toBe(60);
    expect(tot("@petty cash")).toBe(24);
    expect(tot("@rent & co")).toBe(36);
    expect(lines.find((l) => l.key === "#522021")).toMatchObject({ cls: "exp_variable", label: "522021 Installation", month: "2027-01", amount: 5 });
    expect(lines.find((l) => l.key === "@petty cash")?.cls).toBe("exp_fixed");
    expect(lines.filter((l) => l.key === "cls:revenue")).toHaveLength(11);
    expect(lines.find((l) => l.key === "cls:revenue")?.label).toBe("Revenue (from the budget builder)");
  });
  it("actual-by-item", () => {
    const s = setupOf({ products: ["P"], groups: [{ id: "1", name: "One", products: ["X"], customers: [] }] });
    const rows = [{ ...pr("P", "P", 10), p: "2027-01" }, { ...pr("X", "X", 5), p: "2027-01" }, { ...pr("X", "X", 7), p: "2027-03" }, { ...pr("Z", "Z", 2), p: "2027-03" }, { ...pr("P", "P", 99), p: "2026-12" }];
    const m = actualByItem(rows, s, MONTHS);
    expect(m.get("prod:P")?.[0]).toBe(10);
    expect(m.get("grp:1")?.[0]).toBe(5);
    expect(m.get("grp:1")?.[2]).toBe(7);
    expect(m.get("others")?.[2]).toBe(2);
    expect(sum(m.get("prod:P")!)).toBe(10);
  });
});

describe("budget builder: long labels", () => {
  it("line labels are cut to 200 characters", () => {
    const long = "x".repeat(250);
    const e = row({ view: "expense", key: `exp:${long}`, label: long, months: Array(12).fill(10) });
    const lines = budgetToLines([e], new Map(), MONTHS);
    expect(lines).toHaveLength(12);
    expect(lines.every((l) => (l.label ?? "").length === 200)).toBe(true);
  });
});

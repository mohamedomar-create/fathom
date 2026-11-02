import { describe, expect, it } from "vitest";
import {
  budgetAccounts, budgetComparison, fyMonths, productVariance, seedFromForecast, seedFromLastYear, seedProducts, varianceRows,
  type BudgetLine, type BudgetProduct,
} from "@/lib/engine/budget";
import type { AccountLine } from "@/lib/company/types";
import type { SalesProductRow } from "@/lib/engine/sales";

const acct = (code: string, name: string, cls: AccountLine["cls"], amounts: Record<string, number>): AccountLine => ({ id: code, code, name, cls, amounts });

describe("budget months", () => {
  it("a financial year is the 12 months from the company's FY start", () => {
    expect(fyMonths("2026", 1)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"]);
    expect(fyMonths("2026", 7)[0]).toBe("2026-07");
    expect(fyMonths("2026", 7)[11]).toBe("2027-06");
  });
});

describe("products add up to revenue", () => {
  const lines: BudgetLine[] = [
    { key: "#410000", cls: "revenue", label: "Revenue", month: "2026-01", amount: 999 },
    { key: "#510000", cls: "cos_variable", label: "Cost of sales", month: "2026-01", amount: 111 },
    { key: "#610000", cls: "exp_fixed", label: "Rent", month: "2026-01", amount: 300 },
    { key: "#410000", cls: "revenue", label: "Revenue", month: "2026-02", amount: 2000 },
  ];
  const products: BudgetProduct[] = [
    { product: "Mask", category: "Care", month: "2026-01", units: 10, price: 50, unit_cost: 20 },
    { product: "Bed", category: "Care", month: "2026-01", units: 2, price: 900, unit_cost: 400 },
  ];
  it("in a month with products, revenue is units × price and cost of sales is units × unit cost", () => {
    const { accounts } = budgetAccounts(lines, products);
    const sum = (cls: string, m: string) => accounts.filter((a) => a.cls === cls).reduce((s, a) => s + (a.amounts[m] ?? 0), 0);
    expect(sum("revenue", "2026-01")).toBe(10 * 50 + 2 * 900);
    expect(sum("cos_variable", "2026-01")).toBe(10 * 20 + 2 * 400);
    expect(sum("exp_fixed", "2026-01")).toBe(300);
  });
  it("a month with no products keeps its account lines", () => {
    const { accounts } = budgetAccounts(lines, products);
    expect(accounts.filter((a) => a.cls === "revenue").reduce((s, a) => s + (a.amounts["2026-02"] ?? 0), 0)).toBe(2000);
  });
  it("when a product has no unit cost, cost of sales stays as entered and a note says why", () => {
    const { accounts, notes } = budgetAccounts(lines, [{ ...products[0], unit_cost: null }, products[1]]);
    expect(accounts.filter((a) => a.cls === "cos_variable").reduce((s, a) => s + (a.amounts["2026-01"] ?? 0), 0)).toBe(111);
    expect(notes.join(" ")).toMatch(/unit cost/i);
  });
});

describe("seeding", () => {
  const ly = [
    acct("410000", "Revenue", "revenue", { "2025-01": 1000, "2025-02": 2000 }),
    acct("610000", "Rent", "exp_fixed", { "2025-01": 300, "2025-02": 300 }),
    acct("121000", "Bank", "cash", { "2025-01": 5000 }),
  ];
  it("last year + 10% gives last year × 1.1 per account and month, P&L only", () => {
    const s = seedFromLastYear(ly, fyMonths("2026", 1), 10);
    const at = (k: string, m: string) => s.find((l) => l.key === k && l.month === m)?.amount;
    expect(at("#410000", "2026-01")).toBe(1100);
    expect(at("#410000", "2026-02")).toBe(2200);
    expect(at("#610000", "2026-02")).toBe(330);
    expect(s.some((l) => l.cls === "cash")).toBe(false);
  });
  it("a percentage per class overrides the overall one", () => {
    const s = seedFromLastYear(ly, fyMonths("2026", 1), { all: 10, exp_fixed: 0 });
    expect(s.find((l) => l.key === "#610000" && l.month === "2026-01")?.amount).toBe(300);
    expect(s.find((l) => l.key === "#410000" && l.month === "2026-01")?.amount).toBe(1100);
  });
  it("the forecast seeds one line per class and month inside the year", () => {
    const s = seedFromForecast([{ period: "2025-12", pl: { revenue: 9 } }, { period: "2026-01", pl: { revenue: 500, exp_fixed: 120 } }], fyMonths("2026", 1));
    expect(s).toEqual([
      expect.objectContaining({ key: "cls:revenue", cls: "revenue", month: "2026-01", amount: 500 }),
      expect.objectContaining({ key: "cls:exp_fixed", cls: "exp_fixed", month: "2026-01", amount: 120 }),
    ]);
  });
  it("products are seeded from last year's units, average price and unit cost", () => {
    const rows: SalesProductRow[] = [
      { p: "2025-01", r: "Mask", g: "Care", s: "", a: 500, k: 200, ka: 500, q: 10, n: 2 },
      { p: "2025-01", r: "Mask", g: "Care", s: "B", a: 500, k: 200, ka: 500, q: 10, n: 2 },
      { p: "2025-02", r: "Gel", g: "", s: "", a: 80, k: null, ka: null, q: null, n: 1 },
    ];
    const { rows: out, skipped } = seedProducts(rows, fyMonths("2026", 1), 20);
    expect(out).toEqual([{ product: "Mask", category: "Care", month: "2026-01", units: 24, price: 50, unit_cost: 20 }]);
    expect(skipped).toEqual(["Gel"]);
  });
});

describe("budget vs actual", () => {
  const months = fyMonths("2026", 1);
  const actual = [
    acct("410000", "Revenue", "revenue", { "2026-01": 1200, "2026-02": 900 }),
    acct("610000", "Rent", "exp_fixed", { "2026-01": 300, "2026-02": 350 }),
    acct("620000", "Travel", "exp_variable", { "2026-01": 40 }),
  ];
  const budget = budgetAccounts([
    ...months.map((m) => ({ key: "#410000", cls: "revenue" as const, label: "Revenue", month: m, amount: 1000 })),
    ...months.map((m) => ({ key: "cls:exp_fixed", cls: "exp_fixed" as const, label: "Fixed costs", month: m, amount: 300 })),
  ], []).accounts;
  const rows = varianceRows(actual, budget, months, "2026-02");
  const row = (k: string) => rows.find((r) => r.key === k)!;
  it("month and year to date per account", () => {
    expect(row("#410000").month).toMatchObject({ actual: 900, budget: 1000, diff: -100 });
    expect(row("#410000").ytd).toMatchObject({ actual: 2100, budget: 2000, diff: 100 });
  });
  it("the full-year outlook is actual to date plus budget for the rest of the year", () => {
    expect(row("#410000").outlook).toBe(2100 + 10 * 1000);
    expect(row("#410000").fullYear).toBe(12000);
  });
  it("a class line is compared with the class's accounts that have no line of their own", () => {
    expect(row("cls:exp_fixed").ytd).toMatchObject({ actual: 650, budget: 600 });
  });
  it("an account spent with no budget shows with a budget of zero", () => {
    expect(row("#620000").ytd).toMatchObject({ actual: 40, budget: 0, diff: 40 });
  });
  it("cost overruns are worse, revenue above budget is better", () => {
    expect(row("cls:exp_fixed").tone).toBe("worse");
    expect(row("#410000").tone).toBe("better");
  });
  it("the comparison goes through the same statements as the actual figures", () => {
    const c = budgetComparison(budget, { type: "year", end: "2026-02" }, 1, "Budget FY 2026");
    expect(c.P.revenue).toBe(2000);
    expect(c.label).toBe("Budget FY 2026");
  });
});

describe("price and volume", () => {
  it("the volume and price effects add up to the revenue difference", () => {
    const b: BudgetProduct[] = [{ product: "Mask", category: "", month: "2026-01", units: 10, price: 50, unit_cost: null }];
    const a: SalesProductRow[] = [{ p: "2026-01", r: "Mask", g: "", s: "", a: 660, k: null, ka: null, q: 12, n: 3 }];
    const [r] = productVariance(b, a, ["2026-01"]);
    expect(r.volume).toBe((12 - 10) * 50);
    expect(r.price).toBe((55 - 50) * 12);
    expect(r.volume! + r.price!).toBe(r.actual - r.budget);
  });
  it("without actual units the whole difference is unexplained, never split by guess", () => {
    const [r] = productVariance([{ product: "Gel", category: "", month: "2026-01", units: 4, price: 25, unit_cost: null }],
      [{ p: "2026-01", r: "Gel", g: "", s: "", a: 80, k: null, ka: null, q: null, n: 1 }], ["2026-01"]);
    expect(r.volume).toBeNull();
    expect(r.price).toBeNull();
    expect(r.actual - r.budget).toBe(-20);
  });
});

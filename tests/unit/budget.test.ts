import { describe, expect, it } from "vitest";
import {
  budgetAccounts, budgetComparison, fyMonths, productVariance, seedFromForecast, seedFromLastYear, seedProducts, seedWithProducts, varianceRows,
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
  const sum = (accounts: { cls: string; amounts: Record<string, number> }[], cls: string, m: string) => accounts.filter((a) => a.cls === cls).reduce((s, a) => s + (a.amounts[m] ?? 0), 0);
  it("products add their units × price to revenue and units × unit cost to cost of sales; account lines stay (review I1)", () => {
    const { accounts } = budgetAccounts(lines, products);
    expect(sum(accounts, "revenue", "2026-01")).toBe(999 + 10 * 50 + 2 * 900);
    expect(sum(accounts, "cos_variable", "2026-01")).toBe(111 + 10 * 20 + 2 * 400);
    expect(sum(accounts, "exp_fixed", "2026-01")).toBe(300);
  });
  it("a month with no products keeps its account lines", () => {
    const { accounts } = budgetAccounts(lines, products);
    expect(sum(accounts, "revenue", "2026-02")).toBe(2000);
  });
  it("a product with no unit cost adds no cost of sales, and a note names it", () => {
    const { accounts, notes } = budgetAccounts(lines, [{ ...products[0], unit_cost: null }, products[1]]);
    expect(sum(accounts, "cos_variable", "2026-01")).toBe(111 + 800);
    expect(notes.join(" ")).toMatch(/Mask/);
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
  it("last year with products: products for what was sold by unit, one line for the rest, totals = last year + % (review I1)", () => {
    const acc = [
      acct("410000", "Sales", "revenue", { "2025-01": 1000 }),
      acct("420000", "Services", "revenue", { "2025-01": 200 }),
      acct("510000", "Cost of sales", "cos_variable", { "2025-01": 600 }),
      acct("610000", "Rent", "exp_fixed", { "2025-01": 300 }),
    ];
    const sales: SalesProductRow[] = [{ p: "2025-01", r: "Mask", g: "", s: "", a: 500, k: 200, ka: 500, q: 10, n: 1 }];
    const r = seedWithProducts(acc, sales, fyMonths("2026", 1), 10);
    const { accounts } = budgetAccounts(r.lines, r.products);
    const sum2 = (cls: string) => accounts.filter((a) => a.cls === cls).reduce((s, a) => s + (a.amounts["2026-01"] ?? 0), 0);
    expect(sum2("revenue")).toBe(1320);
    expect(sum2("cos_variable")).toBe(660);
    expect(sum2("exp_fixed")).toBe(330);
    expect(r.lines.find((l) => l.key === "cls:revenue" && l.month === "2026-01")?.amount).toBe(770);
    expect(r.lines.some((l) => l.key === "#410000" && l.month === "2026-01")).toBe(false);
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
    expect(row("class:exp_fixed").ytd).toMatchObject({ actual: 650, budget: 600 });
  });
  it("an account spent with no budget shows with a budget of zero", () => {
    expect(row("#620000").ytd).toMatchObject({ actual: 40, budget: 0, diff: 40 });
  });
  it("a class with a class line or products is compared as one row, all its accounts together (review I2)", () => {
    const b = budgetAccounts([
      ...months.slice(1).map((m) => ({ key: "#410000", cls: "revenue" as const, label: "Revenue", month: m, amount: 1000 })),
    ], [{ product: "Mask", category: null, month: "2026-01", units: 20, price: 50, unit_cost: null }]).accounts;
    const act = [acct("410000", "Revenue", "revenue", { "2026-01": 1000 }), acct("420000", "Services", "revenue", { "2026-01": 200 })];
    const rs = varianceRows(act, b, months, "2026-01");
    const rev = rs.filter((r) => r.cls === "revenue");
    expect(rev).toHaveLength(1);
    expect(rev[0].month).toMatchObject({ actual: 1200, budget: 1000 });
    expect(rev[0].fullYear).toBe(1000 + 11 * 1000);
  });
  it("a part month compares with the same share of its budget; the outlook keeps the rest of that month (review I5)", () => {
    const rs = varianceRows(actual, budget, months, "2026-02", 14);
    const r = rs.find((x) => x.key === "#410000")!;
    expect(r.month.budget).toBe(500);
    expect(r.ytd.budget).toBe(1500);
    expect(r.outlook).toBe(2100 + 500 + 10 * 1000);
  });
  it("cost overruns are worse, revenue above budget is better", () => {
    expect(row("class:exp_fixed").tone).toBe("worse");
    expect(row("#410000").tone).toBe("better");
  });
  it("the comparison goes through the same statements as the actual figures", () => {
    const c = budgetComparison(budget, { type: "year", end: "2026-02" }, 1, "Budget FY 2026");
    expect(c.P.revenue).toBe(2000);
    expect(c.label).toBe("Budget FY 2026");
  });
  it("a window the budget doesn't cover compares with zero, never fails", () => {
    const c = budgetComparison(budget, { type: "month", end: "2025-06" }, 1, "B");
    expect(c.P.revenue).toBe(0);
  });
  it("a part month compares with the same share of the budget's month (books to 15 Feb: half of February's budget)", () => {
    const c = budgetComparison(budget, { type: "year", end: "2026-02" }, 1, "B", 14);
    expect(c.P.revenue).toBe(1000 + 500);
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

describe("budget as KPI targets", () => {
  it("revenue, gross margin, EBIT margin and net margin come from the budget for the window", async () => {
    const { budgetTargets } = await import("@/lib/engine/budget");
    const { plCalc } = await import("@/lib/engine");
    const t = budgetTargets(plCalc({ revenue: 1000, cos_variable: 600, exp_fixed: 200, tax_expenses: 50 }));
    expect(t).toEqual({ total_revenue: 1000, gpm: 40, profit_ratio: 20, npat: 15 });
  });
  it("targets typed by hand win over the budget's; the rest come from the budget, already for the whole window", async () => {
    const { analyze } = await import("@/lib/engine");
    const months = [{ period: "2026-01", pl: { revenue: 900, cos_variable: 500 }, bs: {}, has: { pl: true, bs: false } }, { period: "2026-02", pl: { revenue: 900, cos_variable: 500 }, bs: {}, has: { pl: true, bs: false } }];
    const settings = { currency: "EGP", fyStartMonth: 1, taxRate: 0.225, targets: { gpm: 50 } };
    const a = analyze(months as never, { type: "year", end: "2026-02" }, settings, { budgetTargets: { total_revenue: 2000, gpm: 40, profit_ratio: 20, npat: 15 } });
    expect(a.targets.total_revenue).toBe(2000);
    expect(a.targets.gpm).toBe(50);
    expect(a.targets.npat).toBe(15);
  });
});

describe("budget targets after the KPI settings were saved once (review I3, I4)", () => {
  it("a saved target equal to the default counts as not typed; a changed one wins", async () => {
    const { analyze } = await import("@/lib/engine");
    const months = [{ period: "2026-01", pl: { revenue: 900 }, bs: {}, has: { pl: true, bs: false } }];
    // What the KPI form stores on any save: every KPI with its default (null for revenue), one changed by hand.
    const settings = { currency: "EGP", fyStartMonth: 1, taxRate: 0.225, targets: { total_revenue: null, gpm: 35, profit_ratio: 10, npat: 12 } };
    const a = analyze(months as never, { type: "month", end: "2026-01" }, settings, { budgetTargets: { total_revenue: 1000, gpm: 40, profit_ratio: 20, npat: 15 } });
    expect(a.targets.total_revenue).toBe(1000);
    expect(a.targets.gpm).toBe(40);
    expect(a.targets.npat).toBe(12);
  });
  it("the budget for a window is the version whose financial year covers it; none covers it: no budget", async () => {
    const { budgetFor } = await import("@/lib/engine/budget");
    const list = [{ fy: "2026", name: "B26", lines: [], products: [] }, { fy: "2027", name: "B27", lines: [], products: [] }];
    expect(budgetFor(list, "2026-11", 1)?.name).toBe("B26");
    expect(budgetFor(list, "2027-02", 1)?.name).toBe("B27");
    expect(budgetFor(list, "2025-06", 1)).toBeNull();
    expect(budgetFor(list, "2026-03", 7)).toBeNull(); // FY from July: March 2026 is in the year that started in 2025
  });
});

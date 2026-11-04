import { describe, expect, it } from "vitest";
import { planFromAql, cleanPlan, projectMonths } from "@/lib/engine/plan";
import type { MonthData } from "@/lib/engine/types";
import type { SalesData } from "@/lib/engine/sales";
import type { AccountLine } from "@/lib/company/types";

const months: MonthData[] = Array.from({ length: 12 }, (_, i) => {
  const period = `2026-${String(i + 1).padStart(2, "0")}`;
  return {
    period,
    pl: { revenue: i === 11 ? 20000 : 10000, cos_variable: i === 11 ? 12000 : 6000, exp_fixed: 2000, exp_variable: 500, exp_depreciation: 300 },
    bs: { cash: 50000 + i, ar: 11400 * 2, inventory: 9000, wip: 1000, fixed_assets: 40000, intangibles: 2000, other_ca: 3000, investments: 500,
      ap: 5700, tax_liab: 1000, other_cl: 800, other_ncl: 200, std: 4000, ltd: 16000, retained_earnings: 0, other_equity: 0 },
  };
});
const products: SalesData["products"] = [
  { p: "2026-01", r: "Syringes", g: "Disposables", s: "", a: 6000, k: 3600, ka: 6000, q: 60, n: 2 },
  { p: "2026-06", r: "Syringes", g: "Disposables", s: "", a: 6000, k: 3600, ka: 6000, q: 60, n: 2 },
  { p: "2026-03", r: "Service visit", g: "Service", s: "", a: 5000, k: null, ka: null, q: null, n: 1 },
  { p: "2025-12", r: "Old year", g: "x", s: "", a: 999, k: 1, ka: 1, q: 1, n: 1 },
];
const sales: SalesData = { customers: [], products, sources: {} };
const accounts: AccountLine[] = [
  { id: "a1", code: "610", name: "Rent", cls: "exp_fixed", amounts: Object.fromEntries(months.map((m) => [m.period, 1500])) },
  { id: "a2", code: "611", name: "Salaries", cls: "exp_fixed", amounts: Object.fromEntries(months.map((m) => [m.period, 500])) },
  { id: "a3", code: "620", name: "Commissions", cls: "exp_variable", amounts: Object.fromEntries(months.map((m) => [m.period, 500])) },
  { id: "a4", code: "690", name: "Depreciation", cls: "exp_depreciation", amounts: Object.fromEntries(months.map((m) => [m.period, 300])) },
];
const settings = { currency: "EGP", fyStartMonth: 1, taxRate: 0.225, vatRate: 0.14 };

describe("a plan started from the company's books (Aql360 data)", () => {
  const seed = planFromAql({ months, sales, accounts, settings, startYear: 2027 });

  it("takes the opening position from the base year's last balance sheet; equity is the balancing figure", () => {
    expect(seed.opening).toEqual({ cash: 50011, receivables: 22800, inventory: 10000, fixedAssets: 42000, otherAssets: 3500, payables: 5700, otherLiabilities: 2000, loans: 20000 });
    expect(seed.loans).toEqual([expect.objectContaining({ amount: 20000, month: 0, rate: 20, termMonths: 36 })]);
  });

  it("turns the base year's sales into product lines (units, average price, unit cost), the rest into Other sales", () => {
    expect(seed.lines).toEqual([
      expect.objectContaining({ name: "Syringes", units: 120, price: 100, unitCost: 60, growthUnits: 10, growthPrice: 10 }),
      expect.objectContaining({ name: "Other sales", units: 1, price: 5000 }),
    ]);
  });

  it("makes each fixed or variable expense account an overhead row, leaves staff empty and skips depreciation", () => {
    expect(seed.staff).toEqual([]);
    expect(seed.expenses.map((e) => [e.name, e.monthly, e.growth])).toEqual([["Rent", 1500, 10], ["Salaries", 500, 10], ["Commissions", 500, 10]]);
  });

  it("reads seasons, days (net of VAT) and the tax rate", () => {
    expect(seed.season[11]).toBe(20000);
    expect(seed.season[0]).toBe(10000);
    expect(seed.receivableDays).toBe(Math.round((22800 / 1.14 / 130000) * 365));
    expect(seed.taxRate).toBe(22.5);
  });

  it("is a valid plan whose statements agree", () => {
    const p = { id: "p", createdBy: "u", updatedAt: "", ...cleanPlan({ name: "Plan", startYear: 2027, years: 3, ...seed }) };
    expect(projectMonths(p).every((m) => Math.abs(m.check) < 0.05)).toBe(true);
  });

  it("annualises a base year still running, and names seeded rows in the creator's language", () => {
    const part = planFromAql({ months: months.slice(0, 6), sales: { ...sales, products: products.slice(0, 2) }, accounts, settings, startYear: 2027, labels: { loans: "القروض القائمة", other: "مبيعات أخرى" } });
    expect(part.lines[0]).toMatchObject({ name: "Syringes", units: 240 });
    expect(part.expenses[0]).toMatchObject({ name: "Rent", monthly: 1500 });
    expect(part.loans[0].name).toBe("القروض القائمة");
  });

  it("with no sales lines, uses one line from revenue with unit cost from the variable cost of sales", () => {
    const none = planFromAql({ months, sales: { customers: [], products: [], sources: {} }, accounts: [], settings, startYear: 2027 });
    expect(none.lines).toEqual([expect.objectContaining({ units: 1, price: 130000, unitCost: 78000 })]);
    expect(none.expenses.map((e) => e.name)).toEqual(["Overheads"]);
  });

  it("with no books at all, returns an empty seed (a blank page)", () => {
    expect(planFromAql({ months: [], sales: { customers: [], products: [], sources: {} }, accounts: [], settings, startYear: 2027 }).lines).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { salesAnalysis, salesFromAccounts, salesMonths } from "@/lib/engine";
import { untied } from "@/lib/company/ledger-tie";
import { dataMapRows } from "@/components/setup/data-map";
import { linesContext } from "@/lib/ai/context";
import { demoCompany } from "@/lib/company/demo";
import { demoSales } from "@/lib/company/demo-sales";
import { demoExpenses } from "@/lib/company/demo-expenses";

/** One upload feeds every sector with its own part; lines taken from a ledger never outlive the accounts they came from. */
describe("shared data across sectors", () => {
  const d = demoCompany();

  it("without invoice lines, Sales reads the P&L's revenue accounts and ties to revenue", () => {
    const s = salesFromAccounts(d.accounts);
    const revenue = Object.fromEntries(d.months.map((m) => [m.period, m.pl.revenue ?? 0]));
    for (const p of salesMonths(s)) expect(Math.round(s.products.filter((r) => r.p === p).reduce((t, r) => t + r.a, 0))).toBe(Math.round(revenue[p]));
    const a = salesAnalysis(s, { type: "month", end: "2026-09" }, 1, { revenue });
    expect(a.unreconciled).toEqual([]);
    expect(a.byProduct.map((r) => r.name)).toContain("400100 Product Sales");
    expect(a.customers.topName).toBeNull();
  });

  it("months whose ledger lines no longer add up to the P&L are found, the others kept", () => {
    const accounts = [{ cls: "revenue" as const, amounts: { "2026-01": 1000, "2026-02": 2000 } }, { cls: "exp_fixed" as const, amounts: { "2026-01": 300, "2026-02": 400 } }, { cls: "cash" as const, amounts: { "2026-01": 9999 } as Record<string, number> }];
    expect(untied({ sales: { "2026-01": 1000, "2026-02": 1500, "2026-03": 10 }, expenses: { "2026-01": 300.5, "2026-02": 450 } }, accounts)).toEqual({ sales: ["2026-02", "2026-03"], expenses: ["2026-02"] });
  });

  it("the data map shows which part of each upload every sector uses", () => {
    const rows = dataMapRows(d.months, demoSales(), demoExpenses());
    const acc = rows.find((r) => r.key === "accounts")!;
    expect(Object.keys(acc.feeds).sort()).toEqual(["banking", "expenses", "financials", "forecast", "sales"]);
    expect(rows.find((r) => r.key === "ledger")!.feeds).toEqual({ expenses: "suppliers and checks" });
    expect(rows.find((r) => r.key === "sales-file")!.feeds).toEqual({ sales: "customers, products, quantities" });
    expect(dataMapRows(d.months, null, null).map((r) => r.key)).toEqual(["accounts"]);
  });

  it("AI commentary sees customers, products and suppliers for the same period", () => {
    const c = linesContext(d.months, d.accounts, demoSales(), demoExpenses(), { type: "month", end: "2026-09" }, 1, "EGP") as { sales_detail: { top_customers: string[] }; expenses_detail: { top_suppliers: string[]; to_check: string[] } };
    expect(c.sales_detail.top_customers.length).toBeGreaterThan(0);
    expect(c.expenses_detail.top_suppliers.length).toBeGreaterThan(0);
    expect(c.expenses_detail.to_check.some((t) => t.startsWith("possible double payment"))).toBe(true);
  });
});

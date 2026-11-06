import { describe, expect, it } from "vitest";
import { crossChecks } from "@/lib/crosscheck";

const acc = (cls: string, amounts: Record<string, number>) => ({ cls, amounts }) as never;

describe("crossChecks: the same money agrees across modules; differences are shown, never adjusted", () => {
  it("sales agree with revenue in the months both hold", () => {
    const out = crossChecks({ accounts: [acc("revenue", { "2026-01": 100, "2026-02": 200 })], sales: { "2026-01": 100, "2026-02": 200, "2026-03": 50 }, generic: [] });
    const s = out.find((c) => c.key === "sales_revenue")!;
    expect(s.status).toBe("agrees");
    expect(s.months.map((m) => m.period)).toEqual(["2026-01", "2026-02"]);
  });
  it("a difference names its month and amount", () => {
    const out = crossChecks({ accounts: [acc("revenue", { "2026-01": 100 })], sales: { "2026-01": 90 }, generic: [] });
    const s = out.find((c) => c.key === "sales_revenue")!;
    expect(s.status).toBe("differs");
    expect(s.worst).toMatchObject({ period: "2026-01", module: 90, ledger: 100, diff: -10 });
  });
  it("without the books a check is not checked, never red", () => {
    const out = crossChecks({ accounts: [], sales: { "2026-01": 90 }, expenses: { "2026-01": 5 }, generic: [] });
    expect(out.find((c) => c.key === "sales_revenue")).toMatchObject({ status: "not_checked", reason: "no_books" });
    expect(out.find((c) => c.key === "expenses_costs")).toMatchObject({ status: "not_checked" });
  });
  it("a module with no data has no check at all", () => {
    expect(crossChecks({ accounts: [acc("revenue", { "2026-01": 1 })], generic: [] })).toEqual([]);
  });
  it("expenses agree with every cost class", () => {
    const out = crossChecks({ accounts: [acc("cos_variable", { "2026-01": 30 }), acc("exp_fixed", { "2026-01": 70 })], expenses: { "2026-01": 100 }, generic: [] });
    expect(out.find((c) => c.key === "expenses_costs")!.status).toBe("agrees");
  });
  it("a generic module's own tie runs on stored data (balance at its months)", () => {
    const out = crossChecks({ accounts: [acc("ap", { "2026-01": 400 })], generic: [{ key: "ap_open", periods: [{ period: "2026-01", amount: 400, qty: null, rows: 3 }] }] });
    expect(out.find((c) => c.key === "ap_control")).toMatchObject({ a: "ap_open", b: "ledger", status: "agrees" });
  });
  it("checks a viewer can't see are not shown to them", () => {
    const out = crossChecks({ accounts: [acc("revenue", { "2026-01": 100 })], sales: { "2026-01": 100 }, generic: [] }, (k) => k !== "sales");
    expect(out).toEqual([]);
  });
});

import { expenseTotals, salesTotals } from "@/lib/crosscheck";
describe("module month totals for the checks", () => {
  it("adds sales by month across customers", () => {
    expect(salesTotals({ customers: [{ p: "2026-01", a: 10 }, { p: "2026-01", a: 5 }, { p: "2026-02", a: 1 }] } as never)).toEqual({ "2026-01": 15, "2026-02": 1 });
  });
  it("counts only cost classes from the expense lines (stock purchases are not costs)", () => {
    expect(expenseTotals({ accounts: [{ p: "2026-01", c: "exp_fixed", a: 10 }, { p: "2026-01", c: null, a: 99 }, { p: "2026-01", c: "inventory", a: 50 }] } as never)).toEqual({ "2026-01": 10 });
  });
});

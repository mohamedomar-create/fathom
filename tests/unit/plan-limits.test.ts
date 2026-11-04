import { describe, expect, it } from "vitest";
import { cleanPlan, PlanError, shortenPlan } from "@/lib/engine/plan";

describe("plan inputs are checked at the boundary", () => {
  it("refuses an out-of-range value, naming the field", () => {
    expect(() => cleanPlan({ startYear: 2027, taxRate: 500 })).toThrow(PlanError);
    expect(() => cleanPlan({ startYear: 2027, taxRate: 500 })).toThrow(/Income tax %/);
    expect(() => cleanPlan({ startYear: 2027, years: 7 })).toThrow(/Years/);
    expect(() => cleanPlan({ startYear: 2027, lines: Array(201).fill({}) })).toThrow(/up to 200 rows/);
  });
  it("recomputes the opening loans from the month-0 loans", () => {
    const p = cleanPlan({ startYear: 2027, opening: { loans: 999 }, loans: [{ amount: 5000, month: 0, rate: 10, termMonths: 12 }, { amount: 7000, month: 3, rate: 10, termMonths: 12 }] });
    expect(p.opening.loans).toBe(5000);
  });
  it("shortening the plan moves rows after the new end to the last month, so nothing falls out of range", () => {
    const p = cleanPlan({ startYear: 2027, years: 5, staff: [{ name: "A", count: 1, salary: 1, fromMonth: 50 }], capex: [{ name: "Van", amount: 1, month: 60 }], loans: [{ amount: 1, month: 40, rate: 1, termMonths: 12 }], equity: [{ amount: 1, month: 2 }] });
    const s = shortenPlan(p, 3);
    expect(s.years).toBe(3);
    expect([s.staff[0].fromMonth, s.capex[0].month, s.loans[0].month, s.equity[0].month]).toEqual([36, 36, 36, 2]);
    expect(() => cleanPlan(s)).not.toThrow();
  });
});

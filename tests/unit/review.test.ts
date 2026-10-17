import { describe, expect, it } from "vitest";
import type { ClassKey } from "@/lib/engine";
import { reviewChecks } from "@/lib/company/review";

type A = { name: string; cls: ClassKey; amounts: Record<string, number> };
const ps = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"];
/** A steady company: revenue 100k, cost of sales 60k (40% margin), depreciation 2k a month, balanced. */
function books(over: (a: A[]) => void = () => {}): A[] {
  const each = (v: number) => Object.fromEntries(ps.map((p) => [p, v]));
  const a: A[] = [
    { name: "Sales", cls: "revenue", amounts: each(100_000) },
    { name: "Cost of goods sold", cls: "cos_variable", amounts: each(60_000) },
    { name: "Depreciation", cls: "exp_depreciation", amounts: each(2_000) },
    { name: "Bank", cls: "cash", amounts: each(1_000_000) },
    { name: "Equipment", cls: "fixed_assets", amounts: each(500_000) },
    { name: "Capital", cls: "other_equity", amounts: each(1_500_000) },
  ];
  over(a);
  return a;
}

describe("the accountant's review", () => {
  it("steady, clean books raise nothing", () => {
    expect(reviewChecks({ accounts: books() })).toEqual([]);
  });

  it("a balance left in a suspense or adjustment account at month end is a question for management", () => {
    const c = reviewChecks({ accounts: books((a) => a.push({ name: "z Adjustment", cls: "other_equity", amounts: { "2026-07": 280_196.35 } })) });
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ id: "review", severity: "warn", period: "2026-07", statement: "BS" });
    expect(c[0].detail).toMatch(/"z Adjustment" holds 280,196 \(credit\)/);
  });

  it("Odoo's stock interim accounts are explained, not called suspense", () => {
    const c = reviewChecks({ accounts: books((a) => a.push({ name: "w.2 Stock Interim (Received)", cls: "other_cl", amounts: { "2026-07": 13_549_065 } })) });
    expect(c.map((x) => x.title)).toEqual(["Goods received, not yet billed"]);
    expect(c[0].detail).toMatch(/goods received from suppliers whose bills are not yet posted/);
  });

  it("a gross margin far from the company's usual level is flagged with the month", () => {
    const c = reviewChecks({ accounts: books((a) => { a[1].amounts["2026-06"] = 95_000; }) });
    expect(c.map((x) => [x.period, x.title])).toEqual([["2026-06", "Gross margin 5% against a usual 40%"]]);
    expect(c[0].detail).toMatch(/cost of sales is posted when goods are delivered but revenue when the invoice is issued/);
  });

  it("a month with no depreciation when the months around it have it is flagged", () => {
    const c = reviewChecks({ accounts: books((a) => { a[2].amounts["2026-04"] = 0; }) });
    expect(c.map((x) => [x.period, x.title])).toEqual([["2026-04", "No depreciation booked"]]);
  });
});

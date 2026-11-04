import { describe, expect, it } from "vitest";
import type { ClassKey } from "@/lib/engine";
import { reviewChecks } from "@/lib/company/review";

/** Checks that run for every company, from its own books: nothing here depends on a particular company. */
type A = { name: string; cls: ClassKey; amounts: Record<string, number> };
const ps = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"];
const each = (v: number) => Object.fromEntries(ps.map((p) => [p, v]));
/** Revenue 100k a month on 45 days' credit, costs 60k on 30 days, stock 90 days: plausible, so nothing is raised. */
function books(over: (a: A[]) => void = () => {}): A[] {
  const a: A[] = [
    { name: "Sales", cls: "revenue", amounts: each(100_000) },
    { name: "Cost of goods sold", cls: "cos_variable", amounts: each(60_000) },
    { name: "Depreciation", cls: "exp_depreciation", amounts: each(2_000) },
    { name: "Customers", cls: "ar", amounts: each(150_000) },
    { name: "Suppliers", cls: "ap", amounts: each(60_000) },
    { name: "Stock", cls: "inventory", amounts: each(180_000) },
    { name: "Bank", cls: "cash", amounts: each(1_000_000) },
    { name: "Equipment", cls: "fixed_assets", amounts: each(500_000) },
    { name: "Capital", cls: "other_equity", amounts: each(1_770_000) },
  ];
  over(a);
  return a;
}
const titles = (a: A[]) => reviewChecks({ accounts: a }).map((c) => c.title);

describe("checks every company gets", () => {
  it("plausible days raise nothing", () => {
    expect(titles(books())).toEqual([]);
  });

  it("customers owing almost nothing against large sales is flagged (receivables classed elsewhere, or cash sales)", () => {
    const c = reviewChecks({ accounts: books((a) => { a.find((x) => x.cls === "ar")!.amounts = each(3_700); }) });
    expect(c.map((x) => x.title)).toEqual(["Customer days of 1 look too low"]);
    expect(c[0]).toMatchObject({ severity: "warn", period: "2026-07", statement: "BS" });
    expect(c[0].detail).toMatch(/Receivables/);
  });

  it("customer days far above a year are flagged too", () => {
    expect(titles(books((a) => { a.find((x) => x.cls === "ar")!.amounts = each(1_500_000); }))).toEqual(["Customer days of 456 look too high"]);
  });

  it("stock at the books' start sitting on a stock interim account is flagged at the first month", () => {
    const c = reviewChecks({ accounts: books((a) => a.push({ name: "w.2 Stock Interim (Received)", cls: "other_cl", amounts: { "2026-01": -400_000 } })) });
    const first = c.find((x) => x.title === "Opening stock on an interim account");
    expect(first).toMatchObject({ period: "2026-01", statement: "BS" });
    expect(first!.detail).toMatch(/"w.2 Stock Interim \(Received\)" holds 400,000/);
  });

  it("postings to the opening-balance account after the books start are listed by month", () => {
    const open = { "2026-01": 500_000, "2026-02": 500_000, "2026-03": 513_676, "2026-04": 513_676, "2026-05": 501_676, "2026-06": 501_676, "2026-07": 501_676 };
    const c = reviewChecks({ accounts: books((a) => a.push({ name: "xy opining balance", cls: "other_equity", amounts: open })) });
    const hit = c.find((x) => x.title === "Entries in the opening-balance account after the start");
    expect(hit).toMatchObject({ period: "2026-05", statement: "BS" });
    expect(hit!.detail).toMatch(/Mar 2026: \+13,676/);
    expect(hit!.detail).toMatch(/May 2026: -12,000/);
  });

  it("an opening-balance account that never moves after the start is fine", () => {
    expect(titles(books((a) => a.push({ name: "Opening balance", cls: "other_equity", amounts: each(500_000) })))).toEqual([]);
  });
});

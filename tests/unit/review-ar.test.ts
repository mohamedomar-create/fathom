import { describe, expect, it } from "vitest";
import type { ClassKey } from "@/lib/engine";
import { reviewChecks } from "@/lib/company/review";

type A = { name: string; cls: ClassKey; amounts: Record<string, number> };
const ps = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"];
const each = (v: number) => Object.fromEntries(ps.map((p) => [p, v]));
const base = (): A[] => [
  { name: "Sales", cls: "revenue", amounts: each(100_000) },
  { name: "Cost of goods sold", cls: "cos_variable", amounts: { ...each(60_000), "2026-07": 98_000 } },
  { name: "Depreciation", cls: "exp_depreciation", amounts: { ...each(2_000), "2026-04": 0 } },
  { name: "Bank", cls: "cash", amounts: each(1_000_000) },
  { name: "Equipment", cls: "fixed_assets", amounts: each(500_000) },
  { name: "Capital", cls: "other_equity", amounts: each(1_500_000) },
  { name: "z Adjustment", cls: "other_equity", amounts: { "2026-07": 280_196.35 } },
  { name: "w.2 Stock Interim (Received)", cls: "other_cl", amounts: { "2026-07": 90_000 } },
];

describe("the accountant's review speaks Arabic too", () => {
  it("every finding carries an Arabic title and detail with no English sentence in it", () => {
    const c = reviewChecks({ accounts: base() });
    expect(c.length).toBeGreaterThanOrEqual(3);
    for (const x of c) {
      expect(x.ar?.title, x.title).toMatch(/[؀-ۿ]/);
      expect(x.ar?.detail, x.title).toMatch(/[؀-ۿ]/);
      // Account names and figures may stay as written, but no English words of three or more in a row.
      const stripped = (x.ar!.title + " " + x.ar!.detail).replace(/"[^"]*"/g, "").replace(/Odoo|Stock Interim \(Delivered\)/g, "");
      expect(stripped, x.title).not.toMatch(/[A-Za-z]+\s+[A-Za-z]+\s+[A-Za-z]+/);
    }
  });
  it("the figures are the same in both languages", () => {
    const s = reviewChecks({ accounts: base() }).find((x) => x.title.includes("z Adjustment"))!;
    expect(s.ar!.detail).toContain("280,196");
  });
});

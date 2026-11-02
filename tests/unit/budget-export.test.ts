import { describe, expect, it } from "vitest";
import { companySheets, type CompanyExport } from "@/lib/export/company-workbook";

const base: CompanyExport = {
  exportedAt: "2026-11-02T00:00:00Z", orgName: "Org",
  company: { name: "Co", currency: "EGP", fy_start_month: 1, tax_rate: 0.225, industry: null, source: "upload", data_version: 1, last_synced_at: null, ai_context: {}, kpi_config: {}, notes: [] },
  accounts: [], imports: [], commentary: [], reports: [], odoo: null,
};

describe("the company export carries its budgets", () => {
  it("budget lines and products, one row each, with their version", () => {
    const sheets = companySheets({
      ...base,
      budgets: [{ name: "Budget FY 2026", fy: "2026", kind: "original", status: "approved",
        lines: [{ key: "#410000", cls: "revenue", label: "410000 Revenue", month: "2026-01", amount: 1000 }],
        products: [{ product: "Mask", category: "Care", month: "2026-01", units: 10, price: 50, unit_cost: 20 }] }],
    });
    const lines = sheets.find((s) => s.name === "Budget lines")!;
    expect(lines.rows[1]).toEqual(["Budget FY 2026", "2026", "approved", "#410000", "410000 Revenue", "revenue", "2026-01", 1000]);
    const prods = sheets.find((s) => s.name === "Budget products")!;
    expect(prods.rows[1]).toEqual(["Budget FY 2026", "2026", "Mask", "Care", "2026-01", 10, 50, 20]);
  });
  it("no budget, no budget sheets", () => {
    expect(companySheets(base).some((s) => s.name.startsWith("Budget"))).toBe(false);
  });
});

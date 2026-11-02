// The company export carries the highlight settings and every colour mark, so the marks travel with the books.
import { describe, expect, it } from "vitest";
import { companySheets, type CompanyExport } from "@/lib/export/company-workbook";

// Made-up company: never real client data in this public repository.
const base: CompanyExport = {
  exportedAt: "2026-10-10T12:00:00.000Z", orgName: "Delta Advisory",
  company: { name: "Nile Widgets", currency: "EGP", fy_start_month: 1, tax_rate: 0.225, industry: null, source: "upload", data_version: 1, last_synced_at: null, ai_context: {}, notes: {},
    kpi_config: { highlights: { pct: 30, amount: 10000, lines: { gross_profit: { color: "yellow", note: "watch" }, "#4000": { color: "pink", note: "check pricing" } } } } },
  accounts: [
    { code: "4000", name: "Sales", statement: "PL", class: "revenue", amounts: { "2026-01": -1000 } },
    { code: "1000", name: "Cash", statement: "BS", class: "cash", amounts: { "2026-01": 500 } },
  ],
  imports: [], commentary: [], reports: [], odoo: null,
};

describe("highlights in the company export", () => {
  const sheets = companySheets(base);
  const rows = (n: string) => sheets.find((s) => s.name === n)!.rows;
  it("marks each account on its row", () => {
    expect(rows("Accounts")[0]).toEqual(["Code", "Account", "Statement", "Class", "Mark", "Mark note", "2026-01"]);
    expect(rows("Accounts")[1]).toEqual(["4000", "Sallies".replace("llie", "le"), "PL", "revenue", "pink", "check pricing", -1000]);
    expect(rows("Accounts")[2]).toEqual(["1000", "Cash", "BS", "cash", null, null, 500]);
  });
  it("lists the thresholds and statement-line marks on the Company sheet, and not as a KPI", () => {
    const c = rows("Company");
    const at = c.findIndex((r) => r[0] === "Highlights");
    expect(at).toBeGreaterThan(0);
    expect(c.slice(at + 1, at + 4)).toEqual([["Flag a move of at least (%)", 30], ["And at least", 10000], ["Line", "Mark", "Note"]]);
    expect(c).toContainEqual(["gross_profit", "yellow", "watch"]);
    expect(c.some((r) => r[0] === "highlights")).toBe(false);
  });
  it("adds no mark columns when nothing is marked", () => {
    const s = companySheets({ ...base, company: { ...base.company, kpi_config: {} } });
    expect(s.find((x) => x.name === "Accounts")!.rows[0]).toEqual(["Code", "Account", "Statement", "Class", "2026-01"]);
  });
});

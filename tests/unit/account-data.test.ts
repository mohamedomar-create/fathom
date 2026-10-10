import { describe, expect, it } from "vitest";
import { attachment, companySheets, slug, toXlsx, type CompanyExport } from "@/lib/export/company-workbook";
import { supportEmail } from "@/lib/legal";
import { passwordProblem } from "@/lib/password";

// Made-up company: never real client data in this public repository.
const data: CompanyExport = {
  exportedAt: "2026-10-10T12:00:00.000Z",
  orgName: "Delta Advisory",
  company: {
    name: "Nile Widgets", currency: "EGP", fy_start_month: 7, tax_rate: 0.225, industry: "Wholesale", source: "upload", data_version: 3, last_synced_at: "2026-10-01T08:00:00Z",
    ai_context: { goals: "Grow 20%", strategy: "" }, kpi_config: { gpm: { active: true, importance: 3, target: 0.35, alert_active: false, alert_threshold: null } }, notes: {},
  },
  accounts: [
    { code: "4000", name: "Sales", statement: "PL", class: "revenue", amounts: { "2026-02": -2000, "2026-01": -1000 } },
    { code: "1000", name: "Cash", statement: "BS", class: "cash", amounts: { "2026-02": 500 } },
  ],
  imports: [{ created_at: "2026-10-01T08:00:00Z", action: "import", kind: "upload", filename: "gl.xlsx", status: "done", data_version: 3 }],
  commentary: [{ period_key: "month:2026-02", section: "summary", source: "ai", updated_at: "2026-10-02T00:00:00Z", body: "=HYPERLINK(\"http://x\")" }],
  reports: [{ title: "Board pack", period_type: "month", period_end: "2026-02", status: "published", shared: true, expires_at: "2026-12-01T00:00:00Z", published_at: "2026-10-03T00:00:00Z", created_at: "2026-10-03T00:00:00Z" }],
  odoo: { url: "https://acme.odoo.com", db: "acme", login: "me@acme.test", odoo_company_name: "Acme", months_history: 24, status: "ok", last_sync_at: null },
};

describe("company export", () => {
  const sheets = companySheets(data);
  const sheet = (n: string) => sheets.find((s) => s.name === n)!;

  it("has one sheet per kind of data", () => {
    expect(sheets.map((s) => s.name)).toEqual(["Company", "Accounts", "Imports", "Commentary", "Reports", "Odoo connection"]);
    expect(companySheets({ ...data, odoo: null }).map((s) => s.name)).not.toContain("Odoo connection");
  });

  it("puts every account on one row with months in order", () => {
    const a = sheet("Accounts").rows;
    expect(a[0]).toEqual(["Code", "Account", "Statement", "Class", "2026-01", "2026-02"]);
    expect(a[1]).toEqual(["4000", "Sales", "PL", "revenue", -1000, -2000]);
    expect(a[2]).toEqual(["1000", "Cash", "BS", "cash", null, 500]);
  });

  it("lists settings, KPI targets and business context", () => {
    const rows = sheet("Company").rows;
    expect(rows).toContainEqual(["Financial year starts", "July"]);
    expect(rows).toContainEqual(["gpm", true, 3, 0.35, false, null]);
    expect(rows).toContainEqual(["goals", "Grow 20%"]);
    expect(rows.some((r) => r[0] === "strategy")).toBe(false);
  });

  it("never contains secrets", () => {
    const text = JSON.stringify(sheets);
    expect(text).not.toMatch(/api_key|share_token|token/i);
    expect(sheet("Reports").rows[1][4]).toBe("yes");
    expect(sheet("Odoo connection").rows).toContainEqual(["API key", "not exported"]);
  });

  it("writes a real workbook where text stays text", async () => {
    const XLSX = await import("@e965/xlsx");
    const wb = XLSX.read(await toXlsx(sheets), { type: "array" });
    expect(wb.SheetNames).toEqual(sheets.map((s) => s.name));
    const c = wb.Sheets.Commentary.E2;
    expect(c.t).toBe("s");
    expect(c.f).toBeUndefined();
  });

  it("makes safe download names", () => {
    expect(slug("Nile Trading & Co.")).toBe("nile-trading-co");
    expect(slug("شركة النيل")).toBe("شركة-النيل");
    expect(slug("***")).toBe("company");
    expect(attachment("شركة.xlsx")).toBe(`attachment; filename="____.xlsx"; filename*=UTF-8''${encodeURIComponent("شركة.xlsx")}`);
  });
});

describe("password rule", () => {
  it("needs ten characters with letters and numbers", () => {
    expect(passwordProblem("short1")).toMatch(/10 characters/);
    expect(passwordProblem("onlyletters")).toMatch(/letters and numbers/);
    expect(passwordProblem("1234567890")).toMatch(/letters and numbers/);
    expect(passwordProblem("a".repeat(80) + "1")).toMatch(/72/);
    expect(passwordProblem("nile2026river")).toBeNull();
  });
});

describe("support email", () => {
  it("uses the configured address, or a placeholder that is flagged", () => {
    expect(supportEmail("help@reporty.app")).toEqual({ email: "help@reporty.app", placeholder: false });
    expect(supportEmail(undefined).placeholder).toBe(true);
    expect(supportEmail("not an email").placeholder).toBe(true);
  });
});

// What the "clear data" and "delete company" screens show: the database's preview read safely, every table count named in
// words, nothing guessed when the preview is missing or malformed.
import { describe, expect, it } from "vitest";
import { parseResetPreview, RESET_MODULES, confirmCount } from "@/lib/company/reset";

const raw = {
  company: "Reset Co",
  total: 15,
  files: ["c/j/Valuation.xlsx"],
  modules: {
    financials: { records: "8", tables: { accounts: 1, balances: 2, versions: 1, sales_lines_from_ledger: 1, expense_lines_from_ledger: 0, stock_postings: 1, payments_from_ledger: 1, commentary: 1, reports: 0 }, uploads: [{ name: "GL.xlsx", at: "2026-10-01T10:00:00Z", kind: "upload" }] },
    sales: { records: 3, tables: { sales_lines: 3 }, uploads: [] },
    stock: { records: 0, tables: { valuation_layers: 0 }, uploads: [] },
    bogus: { records: 9, tables: {}, uploads: [] },
  },
};

describe("the reset preview", () => {
  const p = parseResetPreview(raw)!;
  it("reads each known module in a fixed order, with numbers as numbers", () => {
    expect(p.modules.map((m) => m.key)).toEqual(["financials", "sales", "stock"]);
    expect(p.modules[0]).toMatchObject({ records: 8, label: "Financials (General Ledger and balances)" });
    expect(p.total).toBe(15);
    expect(p.files).toEqual(["c/j/Valuation.xlsx"]);
  });
  it("names every count in words and leaves out the empty ones", () => {
    expect(p.modules[0].tables).toEqual([
      { key: "accounts", label: "accounts", n: 1 }, { key: "balances", label: "monthly balances", n: 2 }, { key: "versions", label: "saved versions", n: 1 },
      { key: "sales_lines_from_ledger", label: "sales lines taken from the ledger", n: 1 }, { key: "stock_postings", label: "stock postings from the ledger", n: 1 },
      { key: "payments_from_ledger", label: "payments taken from the ledger", n: 1 }, { key: "commentary", label: "commentary notes", n: 1 },
    ]);
  });
  it("a missing or malformed preview is null, never zero", () => {
    expect(parseResetPreview(null)).toBeNull();
    expect(parseResetPreview({ modules: "x" })).toBeNull();
  });
  it("the count sent back is the one shown: one module's records, or the total for everything", () => {
    expect(confirmCount(p, "sales")).toBe(3);
    expect(confirmCount(p, "all")).toBe(15);
    expect(confirmCount(p, "payments")).toBe(0);
  });
  it("every module says what clearing it keeps", () => {
    for (const m of Object.values(RESET_MODULES)) expect(m.keeps.length).toBeGreaterThan(10);
  });
});

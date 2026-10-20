// The repository never holds a company's data: spreadsheets, CSVs and PDFs only as the made-up fixtures listed here,
// and no large files. Company data lives only in the app's database. A new fixture is added to this list on purpose.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { describe, expect, it } from "vitest";

const FIXTURES = new Set([
  "egypt-odoo-general-ledger.xlsx", "egypt-odoo-profit-and-loss.xlsx", "egypt-odoo-trial-balance.xlsx", "odoo-aged-payable.xlsx", "odoo-aged-receivable.xlsx",
  "odoo-invoice-analysis.xlsx", "odoo-payments.xlsx", "odoo-pl-bs.xlsx", "odoo-trial-balance.xlsx", "odoo-vendor-bills.xlsx",
]);
const DATA = /\.(xlsx|xls|xlsm|csv|ods|pdf|xml|json\.gz|zip)$/i;
const files = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);

/** The data files in a list of paths that are not one of the made-up fixtures. */
export function strayData(paths: string[]): string[] {
  return paths.filter((p) => DATA.test(p) && !(p.startsWith("tests/fixtures/files/") && FIXTURES.has(p.slice("tests/fixtures/files/".length))));
}

describe("no company data in the repository", () => {
  it("spreadsheets, CSVs and PDFs only as the listed made-up fixtures", () => {
    expect(strayData(files)).toEqual([]);
  });
  it("a data file anywhere else is caught", () => {
    expect(strayData(["exports/general_ledger.xlsx", "tests/fixtures/files/new-real-file.xlsx", "src/a.ts", "tests/fixtures/files/odoo-payments.xlsx"]))
      .toEqual(["exports/general_ledger.xlsx", "tests/fixtures/files/new-real-file.xlsx"]);
  });
  it("no file over 5 MB", () => {
    const big = files.filter((f) => fs.existsSync(f) && fs.statSync(f).size > 5 * 1024 * 1024);
    expect(big).toEqual([]);
  });
});

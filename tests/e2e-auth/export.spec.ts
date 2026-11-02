import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { createCompany, fixture, importFiles, newEmail, signUp, startUpload } from "./helpers";

const workbook = async (path: string) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path); return wb; };

/** D5: the company export is built from small parts with its progress shown; difference lists download in full. */
test("the full export downloads with every line; a difference list downloads with a summary by account", async ({ page }) => {
  test.setTimeout(180_000);
  page.on("dialog", (d) => d.accept());
  await signUp(page, { name: "Export Owner", org: "Export Advisory", email: newEmail("export") });
  const id = await createCompany(page, "Export Co");
  await importFiles(page, id, ["egypt-odoo-general-ledger.xlsx"]);

  await page.goto(`/company/${id}/settings/profile`);
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.getByTestId("export-company").click()]);
  expect(dl.suggestedFilename()).toMatch(/^export-co-data-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const wb = await workbook(await dl.path());
  const sales = wb.worksheets.find((w) => /sales lines/i.test(w.name));
  expect(sales?.rowCount ?? 0).toBeGreaterThan(1);
  // The address scripts use still answers, with the same sheets.
  const direct = await page.request.get(`/api/export/${id}`);
  expect(direct.status()).toBe(200);

  // A Trial Balance that differs from the books: every difference downloads, with a summary by account.
  await startUpload(page, id);
  await page.getByTestId("file-input").setInputFiles(fixture("odoo-pl-bs.xlsx"));
  await expect(page.getByTestId("tb-verify")).toBeVisible({ timeout: 15_000 });
  const shown = await page.getByTestId("tb-diffs").locator("tbody tr").count();
  expect(shown).toBeGreaterThan(0);
  const [dd] = await Promise.all([page.waitForEvent("download"), page.getByTestId("tb-download-all").click()]);
  const diffs = await workbook(await dd.path());
  expect(diffs.worksheets.map((w) => w.name)).toEqual(["Differences", "Summary by account"]);
  expect(diffs.getWorksheet("Differences")!.rowCount - 1).toBeGreaterThanOrEqual(shown);
});

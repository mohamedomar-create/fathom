import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { createCompany, fixture, importFiles, newEmail, signUp, startUpload } from "./helpers";

/** D1: a P&L and balance sheet saved with "Update these months" keeps the ledger's sales and expense detail. */
test("updating months with a P&L keeps the sales and expense detail, and says where it no longer agrees", async ({ page }) => {
  test.setTimeout(180_000);
  page.on("dialog", (d) => d.accept());
  await signUp(page, { name: "Keep Owner", org: "Keep Advisory", email: newEmail("keep") });
  const id = await createCompany(page, "Keep Co");
  await importFiles(page, id, ["egypt-odoo-general-ledger.xlsx"]);
  await page.goto(`/company/${id}/expenses/suppliers`);
  await expect(page.getByTestId("supplier-table")).toBeVisible();

  await startUpload(page, id);
  await page.getByTestId("file-input").setInputFiles(fixture("odoo-pl-bs.xlsx"));
  await expect(page.getByTestId("tb-verify")).toBeVisible({ timeout: 15_000 });
  // D4: the two choices are side by side, the check first; nothing is hidden behind a fold.
  await expect(page.getByTestId("choice-check")).toBeVisible();
  await expect(page.getByTestId("choice-figures")).toContainText("Use as my figures for these months");
  await page.getByTestId("use-as-figures").click();
  await expect(page.getByTestId("review")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("continue-timeline").click();
  await expect(page.getByTestId("timeline-step")).toBeVisible();
  await expect(page.getByTestId("mode-merge")).toContainText("keep sales, expense and payment detail");
  await page.getByTestId("mode-merge").click();
  await page.getByTestId("commit-import").click();
  await expect(page.getByTestId("done-step")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("done-step")).toContainText("was kept but differs from the new figures");

  // The detail is still there: suppliers and invoice lines, not revenue by account.
  await page.goto(`/company/${id}/expenses/suppliers`);
  await expect(page.getByTestId("supplier-table")).toBeVisible();
  await page.goto(`/company/${id}/sales`);
  await expect(page.getByTestId("sales-headline")).toBeVisible();
  await expect(page.getByTestId("sales-from-accounts")).toHaveCount(0);
});

/** D2: the template with the company's data comes back unchanged except for the one cell changed in it. */
test("the template with your data: download, change one cell, upload with Update: only that month moves, the detail stays", async ({ page, request }) => {
  test.setTimeout(180_000);
  page.on("dialog", (d) => d.accept());
  await signUp(page, { name: "Round Owner", org: "Round Advisory", email: newEmail("round") });
  const id = await createCompany(page, "Round Co");
  await importFiles(page, id, ["egypt-odoo-general-ledger.xlsx"]);

  // Members only: signed out, nothing comes back.
  expect((await request.get(`/api/templates/financials?id=${id}&data=1`)).status()).toBe(401);
  const res = await page.request.get(`/api/templates/financials?id=${id}&data=1`);
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toBe("no-store");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await res.body() as unknown as ArrayBuffer);
  const pl = wb.getWorksheet("P&L")!;
  const head = pl.getRow(5).values as unknown[];
  const firstMonth = String(head[4]);
  expect(firstMonth).toMatch(/^\d{4}-\d{2}$/);
  let changed = false;
  pl.eachRow((row, n) => {
    if (changed || n < 6 || !/revenue/i.test(String(row.getCell(3).value ?? ""))) return;
    const v = Number(row.getCell(4).value ?? 0);
    if (!v) return;
    row.getCell(4).value = v + 1000;
    changed = true;
  });
  expect(changed).toBe(true);

  await startUpload(page, id);
  await page.getByTestId("file-input").setInputFiles({ name: "with-data.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await wb.xlsx.writeBuffer()) });
  await expect(page.getByTestId("tb-verify")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("use-as-figures").click();
  await expect(page.getByTestId("review")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("continue-timeline").click();
  await page.getByTestId("mode-merge").click();
  await page.getByTestId("commit-import").click();
  await expect(page.getByTestId("done-step")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("done-step")).toContainText(/Sales detail for \w{3} \d{4} was kept but differs from the new figures by -1,000\./);
  await page.goto(`/company/${id}/expenses/suppliers`);
  await expect(page.getByTestId("supplier-table")).toBeVisible();
});

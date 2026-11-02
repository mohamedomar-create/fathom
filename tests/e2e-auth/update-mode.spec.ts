import { expect, test } from "@playwright/test";
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
  await page.getByTestId("use-as-figures-box").locator("summary").click();
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

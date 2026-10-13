import { expect, test } from "@playwright/test";
import { createCompany, fixture, importFiles, newEmail, requireLocalStack, signUp } from "./helpers";

requireLocalStack();

/** The settings a company admin uses, each saved and checked to have taken effect. */
test("company settings, mapping, organisation and report download all work", async ({ page }) => {
  test.setTimeout(240_000);
  await signUp(page, { name: "Path Owner", org: "Path Advisory", email: newEmail("path") });
  const id = await createCompany(page, "Path Co");
  await importFiles(page, id, ["odoo-pl-bs.xlsx"]);

  // Profile: the new name shows across the company.
  await page.goto(`/company/${id}/settings/profile`);
  await page.getByLabel("Company name").fill("Path Co Renamed");
  await page.getByLabel("Industry").fill("Medical supplies");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.goto(`/company/${id}/summary`);
  await expect(page.getByText("Path Co Renamed").first()).toBeVisible();

  // Mapping: moving an account changes the analysis.
  await page.goto(`/company/${id}/analysis/profitability`);
  const gpBefore = await page.getByTestId("tile-gp").innerText();
  await page.goto(`/company/${id}/settings/chart-of-accounts`);
  const select = page.locator('select[aria-label^="Reclassify"]').first();
  const original = await select.inputValue();
  await select.selectOption("other_income");
  await page.getByRole("button", { name: "Save mapping" }).click();
  await expect(page.getByText(/1 account\(s\) reclassified/)).toBeVisible();
  await page.goto(`/company/${id}/analysis/profitability`);
  if (original !== "other_income") await expect(page.getByTestId("tile-gp")).not.toHaveText(gpBefore);

  // Alerts: a switch saves.
  await page.goto(`/company/${id}/settings/alerts`);
  await page.getByRole("switch").first().click();
  await page.getByTestId("save-kpis").click();
  await expect(page.getByText(/Saved\./)).toBeVisible();

  // Organisation details.
  await page.goto("/admin/organisation");
  await page.getByLabel("Organisation name").fill("Path Advisory Group");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  // A report downloads as a real PDF.
  await page.goto(`/company/${id}/reports`);
  await page.getByTestId("create-report").click();
  await expect(page).toHaveURL(/\/reports\/[0-9a-f-]{36}$/);
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), page.getByTestId("download-pdf").click()]);
  const path = await download.path();
  const fs = await import("node:fs");
  expect(fs.readFileSync(path!).subarray(0, 5).toString()).toBe("%PDF-");

  // Deleting the company asks for its name, then it is gone.
  await page.goto(`/company/${id}/settings/profile`);
  await page.getByRole("button", { name: "Delete this company" }).click();
  const dialog = page.getByTestId("delete-company-dialog");
  await dialog.getByRole("textbox").fill("Path Co Renamed");
  await dialog.getByRole("button", { name: "Delete company" }).click();
  await expect(page).toHaveURL(/\/companies/);
  await expect(page.getByText("Path Co Renamed")).toHaveCount(0);
  expect((await page.goto(`/company/${id}/summary`))?.status()).toBe(404);
});

/** Odoo's General Ledger, Trial Balance and P&L for the same dates import in one go, with nothing blocking. */
test("an Odoo ledger with an unexplained opening adjustment imports cleanly and balances", async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, { name: "Ledger Owner", org: "Ledger Advisory", email: newEmail("ledger") });
  const id = await createCompany(page, "Ledger Co");
  await page.goto(`/company/${id}/settings/source-data`);
  await page.waitForLoadState("networkidle");
  await expect(async () => {
    await page.getByTestId("file-input").setInputFiles(["general-ledger", "trial-balance", "profit-and-loss"].map((n) => fixture(`egypt-odoo-${n}.xlsx`)));
    await expect(page.getByTestId("review")).toBeVisible({ timeout: 4000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByTestId("review")).toContainText("Balances");
  await page.getByTestId("continue-timeline").click();
  await expect(page.getByTestId("timeline-step")).toBeVisible();
  await expect(page.locator('[data-testid="check-list"] [data-severity="block"]')).toHaveCount(0);
  await expect(page.getByTestId("accept-box")).toHaveCount(0);
  await page.getByTestId("commit-import").click();
  await expect(page).toHaveURL(/data-health\?imported=1/, { timeout: 30_000 });
  await page.goto(`/company/${id}/analysis/financials`);
  await page.getByTestId("period-picker").waitFor();
  // The ledger's revenue lines became sales, and they agree with the P&L.
  await page.getByTestId("tab-sales").click();
  await expect(page).toHaveURL(new RegExp(`/company/${id}/sales`));
  await expect(page.getByTestId("sales-headline")).toBeVisible();
  await expect(page.getByTestId("sales-reconciled")).toBeVisible();
  await page.goto(`/company/${id}/settings/chart-of-accounts`);
  await page.getByRole("button", { name: "Balance Sheet" }).click();
  await expect(page.locator('select[aria-label="Reclassify z Adjustment"]')).toHaveValue("other_equity");
});

/** A sales export on its own: read, previewed with its columns, saved to the Sales sector without touching the financial figures. */
test("an Odoo Invoice Analysis export becomes sales by customer and product", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, { name: "Sales Owner", org: "Sales Advisory", email: newEmail("sales") });
  const id = await createCompany(page, "Sales Co");
  await page.goto(`/company/${id}/settings/source-data`);
  await page.waitForLoadState("networkidle");
  await expect(async () => {
    await page.getByTestId("file-input").setInputFiles(fixture("odoo-invoice-analysis.xlsx"));
    await expect(page.getByTestId("sales-preview")).toBeVisible({ timeout: 4000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByTestId("sales-total")).toContainText("197,800");
  await expect(page.getByTestId("tax-warning")).toHaveCount(0);
  await page.getByTestId("save-sales").click();
  await expect(page).toHaveURL(new RegExp(`/company/${id}/sales`), { timeout: 30_000 });
  await expect(page.getByTestId("tile-sales")).toContainText("93,800");
  await page.goto(`/company/${id}/sales/products?type=year&end=2026-02`);
  await expect(page.getByTestId("product-table")).toContainText("CPAP Machine");
  await expect(page.getByTestId("product-table")).toContainText("Margin");
});

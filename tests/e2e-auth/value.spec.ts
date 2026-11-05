// Company value, signed in: valued from the company's own books, and an editor's assumptions are kept for everyone.
import { expect, test } from "@playwright/test";
import { createCompany, importFiles, newEmail, requireLocalStack, signUp } from "./helpers";

requireLocalStack();

test("a company is valued from its books, and saved assumptions stay after a reload", async ({ page }) => {
  test.slow();
  await signUp(page, { name: "Vera Value", org: "Value Advisory", email: newEmail("value") });
  const id = await createCompany(page, "Value Trading");
  await importFiles(page, id, ["egypt-odoo-general-ledger.xlsx"]);

  await page.goto(`/company/${id}/value`);
  await expect(page.getByTestId("value-best")).toBeVisible();
  await expect(page.getByTestId("ff-dcf")).toBeVisible();

  await page.goto(`/company/${id}/value/assumptions`);
  await page.getByTestId("va-riskFree").fill("30");
  await page.getByTestId("va-save").click();
  await expect(page.getByTestId("va-msg")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByTestId("va-riskFree")).toHaveValue("30");
});

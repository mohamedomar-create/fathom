// Valuation, signed in: valued from the company's own books, and an editor's assumptions are kept for everyone.
import { expect, test } from "@playwright/test";
import { createCompany, importFiles, newEmail, requireLocalStack, signUp } from "./helpers";

requireLocalStack();

test("a company is valued from its books, and saved assumptions stay after a reload", async ({ page }) => {
  test.slow();
  await signUp(page, { name: "Vera Value", org: "Value Advisory", email: newEmail("value") });
  const id = await createCompany(page, "Value Trading");
  await importFiles(page, id, ["egypt-odoo-general-ledger.xlsx"]);

  await page.goto(`/company/${id}/valuation`);
  await expect(page.getByTestId("value-best")).toBeVisible();
  await expect(page.getByTestId("ask-pitch")).toBeVisible();
  await page.getByTestId("view-expert").click();
  await expect(page.getByTestId("ff-dcf")).toBeVisible();

  await page.goto(`/company/${id}/valuation/assumptions`);
  await page.getByTestId("va-riskFree").fill("30");
  await page.getByTestId("va-save").click();
  await expect(page.getByTestId("va-msg")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByTestId("va-riskFree")).toHaveValue("30");

  // The owner's scores are kept too, and bring in the startup method.
  for (const [k, n] of [["idea", "4"], ["prototype", "5"], ["team", "4"], ["partners", "3"], ["sales", "5"]]) await page.getByTestId(`va-berkusScores-${k}`).fill(n);
  await page.getByTestId("va-save").click();
  await expect(page.getByTestId("va-msg")).toHaveText("Saved");
  await page.goto(`/company/${id}/valuation?view=simple`);
  await page.getByTestId("view-simple").click();
  await expect(page.getByTestId("ask-berkus")).not.toContainText("Score your company");
});

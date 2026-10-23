import { expect, test } from "@playwright/test";
import { createCompany, fixture, newEmail, requireLocalStack, signUp, startUpload } from "./helpers";
import { STOCK_FILE, stockWorkbook } from "../fixtures/stock-workbook";

requireLocalStack();

/** D15: a file that doesn't match the chosen card stops at Next until the person switches card. */
test("an invoice file on the accounts card cannot go on until the card is switched", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, { name: "Kind Owner", org: "Kind Advisory", email: newEmail("kind") });
  const id = await createCompany(page, "Kind Co");
  await startUpload(page, id, "accounts");
  await page.getByTestId("file-input").setInputFiles(fixture("odoo-invoice-analysis.xlsx"));
  await expect(page.getByTestId("upload-notice")).toContainText("looks like");
  await expect(page.getByTestId("sales-next")).toBeDisabled();
  await expect(page.getByTestId("wiz-nav")).toContainText("Switch above to continue");
  await page.getByTestId("switch-kind").click();
  await expect(page.getByTestId("upload-notice")).toHaveCount(0);
  await expect(page.getByTestId("sales-next")).toBeEnabled();
});

/** D24: stock sheets dropped on the accounts card are never saved from there; the screen sends them to the Stock card. */
test("stock exports on the accounts card are sent to the Stock card, not saved", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, { name: "Stock Owner", org: "Stock Advisory", email: newEmail("stockcard") });
  const id = await createCompany(page, "Stock Card Co");
  await startUpload(page, id, "accounts");
  await page.getByTestId("file-input").setInputFiles({ ...STOCK_FILE, buffer: await stockWorkbook() });
  await expect(page.getByTestId("stock-elsewhere")).toContainText("Upload them on the Stock card");
  await expect(page.getByTestId("commit-import")).toHaveCount(0);
  await page.getByTestId("go-stock").click();
  await expect(page.getByTestId("stock-elsewhere")).toHaveCount(0);
});

import { expect, test, type Page } from "@playwright/test";
import { newEmail, requireLocalStack, signUp, startUpload } from "./helpers";
import { simpleSheet } from "../fixtures/simple";

requireLocalStack();

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function saveProfile(page: Page) {
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Saved.")).toBeVisible({ timeout: 15_000 });
}

/**
 * Setup → Simple → upload both sheets → confirm the columns → dashboard → change a line → switch to Full (every line
 * still there) → back to Simple.
 */
test("a Simple company: two sheets in, figures out, lines kept when switching to Full and back", async ({ page }) => {
  test.setTimeout(240_000);
  await signUp(page, { name: "Shop Owner", org: "Shop Advisory", email: newEmail("simple") });
  await page.goto("/companies");
  await page.getByTestId("add-company").click();
  await page.getByTestId("tile-simple").click();
  await page.getByLabel("Company name").fill("Corner Shop");
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(/\/company\/[0-9a-f-]{36}\/data/);
  const id = page.url().match(/\/company\/([0-9a-f-]{36})/)![1];
  await expect(page.getByTestId("simple-steps")).toBeVisible();
  await expect(page.getByTestId("data-nav")).not.toContainText("Odoo live");

  // Before any upload the Overview invites the two sheets (never a page of zeros).
  await page.goto(`/company/${id}/simple`);
  await expect(page.getByTestId("simple-empty")).toBeVisible();

  // The Sales sheet: read, columns shown to confirm, saved.
  await startUpload(page, id, "sales", "sales");
  await page.getByTestId("file-input").setInputFiles({ name: "sales.xlsx", mimeType: XLSX_TYPE, buffer: Buffer.from(simpleSheet("clean", "sales")) });
  await expect(page.getByTestId("sales-preview")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("sales-total")).toContainText("5,000");
  await page.getByTestId("sales-next").click();
  await page.getByTestId("save-sales").click();
  await expect(page.getByTestId("done-step")).toBeVisible({ timeout: 30_000 });

  // The Expenses sheet.
  await startUpload(page, id, "expenses", "expenses");
  await page.getByTestId("file-input").setInputFiles({ name: "expenses.xlsx", mimeType: XLSX_TYPE, buffer: Buffer.from(simpleSheet("clean", "expenses")) });
  await expect(page.getByTestId("expenses-preview")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("expenses-total")).toContainText("3,900");
  await page.getByTestId("expenses-next").click();
  await page.getByTestId("save-expenses").click();
  await expect(page.getByTestId("done-step")).toBeVisible({ timeout: 30_000 });

  // Without opening cash the cash figures say what they need.
  await page.goto(`/company/${id}/simple`);
  await expect(page.getByTestId("simple-summary")).toBeVisible();
  await expect(page.getByTestId("simple-revenue")).toContainText("5,000");
  await expect(page.getByTestId("simple-net-profit")).toContainText("900");
  await expect(page.getByTestId("simple-gross-margin")).toContainText("60%");
  await expect(page.getByTestId("simple-top1")).toContainText("60%");
  await expect(page.getByTestId("simple-cash")).toHaveAttribute("data-needs", "opening_cash");
  await expect(page.getByTestId("simple-ageing-receivables")).toContainText("500");
  // Every figure opens its formula.
  await page.getByTestId("simple-gross-margin").getByRole("button").click();
  await expect(page.getByTestId("simple-formula")).toContainText("Gross Profit");
  await page.keyboard.press("Escape");

  // Opening cash in the profile: the cash balance follows (10,000 + 4,500 in − 3,600 out).
  await page.goto(`/company/${id}/settings/profile`);
  await page.getByTestId("opening-cash").fill("10000");
  await page.getByTestId("opening-cash-date").fill("2025-12-31");
  await saveProfile(page);
  await page.goto(`/company/${id}/simple/cash`);
  await expect(page.getByTestId("simple-cash")).toContainText("10,900");
  await expect(page.getByTestId("simple-forecast-revenue-method")).toContainText("Method:");

  // A line changed in the app: March's sale becomes 2,000 (revenue 5,500); then one added and one removed.
  await page.goto(`/company/${id}/data/lines`);
  await page.getByTestId("lines-month").selectOption("2026-03");
  await expect(page.getByTestId("lines-row")).toHaveCount(1);
  await page.getByTestId("lines-edit").click();
  await page.getByTestId("lines-edit-amount").fill("2000");
  await page.getByTestId("lines-save").click();
  await expect(page.getByTestId("lines-row")).toContainText("2,000", { timeout: 15_000 });
  await page.getByTestId("lines-add-day").fill("2026-03-20");
  await page.getByTestId("lines-add-customer").fill("Walk-in");
  await page.getByTestId("lines-add-amount").fill("250");
  await page.getByTestId("lines-add").click();
  await expect(page.getByTestId("lines-row")).toHaveCount(2, { timeout: 15_000 });
  await page.getByTestId("lines-row").filter({ hasText: "Walk-in" }).getByTestId("lines-remove").click();
  await page.getByTestId("lines-remove-dialog").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByTestId("lines-row")).toHaveCount(1, { timeout: 15_000 });
  await page.goto(`/company/${id}/simple`);
  await expect(page.getByTestId("simple-revenue")).toContainText("5,500");

  // Switch to Full: the full navigation comes back and every line is still there.
  await page.goto(`/company/${id}/settings/profile`);
  await page.getByTestId("mode-full").check();
  await saveProfile(page);
  await page.goto(`/company/${id}/data`);
  await expect(page.getByTestId("simple-steps")).toHaveCount(0);
  await expect(page.getByTestId("data-nav")).toContainText("Readiness");
  await page.goto(`/company/${id}/sales?type=year&end=2026-03`);
  await expect(page.getByTestId("tile-sales")).toContainText("5,500", { timeout: 30_000 });

  // And back to Simple: nothing was lost.
  await page.goto(`/company/${id}/settings/profile`);
  await page.getByTestId("mode-simple").check();
  await saveProfile(page);
  await page.goto(`/company/${id}`);
  await expect(page).toHaveURL(new RegExp(`/company/${id}/simple`), { timeout: 30_000 });
  await expect(page.getByTestId("simple-revenue")).toContainText("5,500");
  // Cash: March's sale, paid on 20 March, now brings in 2,000: 10,000 + 5,000 − 3,600.
  await expect(page.getByTestId("simple-cash")).toContainText("11,400");
});

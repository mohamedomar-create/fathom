import { expect, test } from "@playwright/test";

// The demo's budget: its own page, the Budget comparison on Financials and a Budget column in the report.
test("the demo budget page shows budget against actual, by account and by product", async ({ page }) => {
  await page.goto("/demo/analysis/budget");
  await expect(page.getByTestId("budget-demo")).toBeVisible();
  await expect(page.getByTestId("budget-status")).toContainText("Approved");
  expect(await page.getByTestId("budget-vs-row").count()).toBeGreaterThan(5);
  await expect(page.getByTestId("budget-headline")).toContainText("budget");
  await expect(page.locator('[data-testid="budget-vs-row"] td[data-tone="worse"], [data-testid="budget-vs-row"] td[data-tone="better"]').first()).toBeVisible();
  await page.getByTestId("budget-tab-accounts").click();
  expect(await page.getByTestId("budget-row").count()).toBeGreaterThan(5);
  // Nothing can be changed in the demo.
  await expect(page.locator("[data-testid^=budget-cell-]")).toHaveCount(0);
  await page.getByTestId("budget-tab-products").click();
  expect(await page.getByTestId("budget-product-row").count()).toBeGreaterThan(0);
});

test("Financials compares with the budget; the report has a Budget column", async ({ page }) => {
  await page.goto("/demo/analysis/financials");
  await page.getByTestId("fin-compare").click();
  await page.getByRole("button", { name: "Budget", exact: true }).click();
  await expect(page.getByTestId("pl-table").locator("thead")).toContainText("Budget");
  await expect(page.getByTestId("pl-table").locator('tr[data-line="revenue"] td').nth(2)).not.toHaveText("–");
  await page.goto("/demo/reports");
  await expect(page.getByTestId("report-budget-cell").first()).toBeVisible({ timeout: 15_000 });
});

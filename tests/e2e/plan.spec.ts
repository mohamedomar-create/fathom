import { expect, test } from "@playwright/test";

test("the demo business plan: started from the books, every tab works, a change moves the figures, the report prints", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/demo/planning");
  await expect(page.getByTestId("plan-workspace")).toBeVisible();
  await expect(page.getByTestId("plan-kpi-sales")).toContainText("EGP");
  await expect(page.getByTestId("plan-checks").locator("li").first()).toBeVisible();

  // Sales: a price change shows in the Impact strip at once.
  await page.getByTestId("plan-tab-sales").click();
  await expect(page).toHaveURL(/tab=sales/);
  const before = await page.getByTestId("plan-impact").innerText();
  const price = page.getByTestId("plan-lines").getByRole("textbox", { name: "Price" }).first();
  await price.click();
  await price.fill("99999");
  await expect(page.getByTestId("plan-impact")).not.toHaveText(before);
  await expect(page.getByTestId("plan-impact")).toContainText("since opened");

  // Funding: no opening cash and a big investment make cash run out; the plan check offers the fix and it clears the gap.
  await page.getByTestId("plan-tab-funding").click();
  await page.getByTestId("plan-open-cash").fill("0");
  await page.getByTestId("plan-capex-first").click();
  await page.getByTestId("plan-capex").getByRole("textbox", { name: "Amount" }).fill("90000000");
  await page.getByTestId("plan-tab-overview").click();
  await expect(page.getByTestId("plan-kpi-cash")).toContainText("Funding needed");
  await page.getByTestId("plan-fund-fix").click();
  await expect(page.getByTestId("plan-kpi-cash")).toContainText("Lowest cash");

  // Statements agree in every month.
  await page.getByTestId("plan-tab-statements").click();
  await expect(page.getByTestId("plan-agree")).toBeVisible();
  await expect(page.getByTestId("plan-table-pl")).toContainText("Net profit");

  // Scenarios: three cases and the tornado.
  await page.getByTestId("plan-tab-scenarios").click();
  await expect(page.getByTestId("plan-case-worst")).toBeVisible();
  await expect(page.getByTestId("plan-tornado").locator("li").first()).toBeVisible();

  // Report: the feasibility study with its numbered sections.
  await page.getByTestId("plan-tab-report").click();
  await expect(page.getByTestId("plan-report-doc")).toContainText("A feasibility study for");
  await expect(page.getByTestId("plan-print")).toBeVisible();
});

test("Budget lives under Planning, and its old address still works", async ({ page }) => {
  await page.goto("/demo/analysis/budget");
  await expect(page).toHaveURL(/\/demo\/planning\/budget/);
});

test("the business plan in Arabic: right to left, every tab named in Arabic", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "lang", value: "ar", url: baseURL! }]);
  await page.goto("/demo/planning");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("plan-tab-overview")).toContainText("نظرة عامة");
  await expect(page.getByTestId("plan-tab-report")).toContainText("التقرير");
});

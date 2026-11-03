import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// The demo's budget: its own page, the Budget comparison on Financials and a Budget column in the report.
test("the demo budget page is a budget builder version, read-only, with budget against actual", async ({ page }) => {
  await page.goto("/demo/analysis/budget");
  await expect(page.getByTestId("budget-demo")).toBeVisible();
  await expect(page.getByTestId("budget-status")).toContainText("Approved");
  // The builder tabs replace the old Accounts / Products grids (budget-tab-accounts, budget-tab-products).
  await expect(page.getByTestId("budget-builder")).toBeVisible();
  for (const k of ["revenue", "customers", "streams", "groups", "expenses", "vs"]) await expect(page.getByTestId(`btab-${k}`)).toBeVisible();
  await expect(page.getByTestId("budget-tab-accounts")).toHaveCount(0);
  await page.getByTestId("btab-vs").click();
  expect(await page.getByTestId("budget-vs-row").count()).toBeGreaterThan(5);
  await expect(page.getByTestId("budget-headline")).toContainText("budget");
  await expect(page.locator('[data-testid="budget-vs-row"] td[data-tone="worse"], [data-testid="budget-vs-row"] td[data-tone="better"]').first()).toBeVisible();
  // Nothing can be changed in the demo.
  for (const k of ["revenue", "customers", "expenses"]) {
    await page.getByTestId(`btab-${k}`).click();
    await expect(page.locator("[data-testid^=bsheet-input-]")).toHaveCount(0);
    await expect(page.getByTestId("budget-save")).toHaveCount(0);
  }
  await page.getByTestId("btab-revenue").click();
  expect(await page.locator("[data-testid^=bsheet-row-]").count()).toBeGreaterThan(5);
});

const nonZero = (t: string | null) => /[1-9]/.test(t ?? "");

test("the demo builder: groups Hospitals and Homecare, a rental stream, customers that add up", async ({ page }) => {
  await page.goto("/demo/analysis/budget");
  await page.getByTestId("btab-groups").click();
  const groups = page.getByTestId("bgroups-row");
  await expect(groups.filter({ hasText: "Hospitals" })).toHaveCount(1);
  await expect(groups.filter({ hasText: "Homecare" })).toHaveCount(1);
  expect(nonZero(await groups.filter({ hasText: "Hospitals" }).locator("td").last().textContent())).toBe(true);
  expect(nonZero(await groups.filter({ hasText: "Homecare" }).locator("td").last().textContent())).toBe(true);
  await page.getByTestId("btab-streams").click();
  const rental = page.getByTestId("bstreams-row").nth(1);
  expect(nonZero(await rental.locator("td").last().textContent())).toBe(true);
  await page.getByTestId("btab-customers").click();
  expect(await page.locator("[data-testid^=bsheet-row-]").count()).toBeGreaterThan(5);
  await expect(page.getByTestId("customer-diff")).toHaveCount(0);
});

for (const lang of ["en", "ar"] as const) {
  test(`the demo budget page meets WCAG 2.2 AA on every builder tab (${lang})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "lang", value: lang, url: baseURL! }]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/demo/analysis/budget");
    await page.waitForLoadState("networkidle").catch(() => {});
    const found: string[] = [];
    for (const k of ["revenue", "customers", "streams", "groups", "expenses", "vs"]) {
      await page.getByTestId(`btab-${k}`).click();
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      found.push(...r.violations.map((v) => `${k} ${v.id} (${v.impact}): ${v.nodes.length}× e.g. ${v.nodes[0]?.target.join(" ")}`));
    }
    expect(found, found.join("\n")).toEqual([]);
  });
}

test("Financials compares with the budget; the report has a Budget column", async ({ page }) => {
  await page.goto("/demo/analysis/financials");
  await page.getByTestId("fin-compare").click();
  await page.getByRole("button", { name: "Budget", exact: true }).click();
  await expect(page.getByTestId("pl-table").locator("thead")).toContainText("Budget");
  await expect(page.getByTestId("pl-table").locator('tr[data-line="revenue"] td').nth(2)).not.toHaveText("–");
  await page.goto("/demo/reports");
  await expect(page.getByTestId("report-budget-cell").first()).toBeVisible({ timeout: 15_000 });
});

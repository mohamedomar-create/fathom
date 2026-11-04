import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// The demo's budget: its own page, the Budget comparison on Financials and a Budget column in the report.
test("the demo budget page is a budget builder version, read-only, with budget against actual", async ({ page }) => {
  await page.goto("/demo/planning/budget");
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

// The visual pass: summary cards, compact amounts with the exact one on hover, one chart per tab, sort and search.
test("the demo budget: cards, compact amounts, a chart on every tab, sort by amount and search", async ({ page }) => {
  await page.goto("/demo/planning/budget");
  await expect(page.getByTestId("budget-demo")).toHaveText("Demo: a budget built from this year's figures with a few changes. Sign up to build your own.");
  for (const k of ["revenue", "gp", "exp", "np"]) await expect(page.getByTestId(`bcards-${k}`)).toBeVisible();
  // A credible story: the revenue changed on this year's estimate and the year makes a profit.
  await expect(page.getByTestId("bcards-revenue").locator("[data-dir]")).toHaveAttribute("data-dir", /up|down/);
  await expect(page.getByTestId("bcards-revenue").locator("[data-dir]")).not.toContainText(/^▬?0%$/);
  expect(Number((await page.getByTestId("bsheet-strip-np").getAttribute("title"))!.replace(/,/g, ""))).toBeGreaterThan(0);
  await expect(page.getByTestId("bcards-revenue")).toContainText(/\d(\.\d)?(K|M)/);
  // Every amount of 1,000 or more reads compact; its title holds the exact figure.
  const total = page.getByTestId("bsheet-total-new");
  await expect(total).toHaveText(/^-?[\d.]+(K|M|B)$/);
  expect(await total.getAttribute("title")).toMatch(/^[\d,]+$/);
  // The exact figure from the keyboard too: focus shows it, Enter swaps back, leaving goes back to compact.
  await total.focus();
  await expect(total).toHaveText(/^[\d,]+$/);
  await page.keyboard.press("Enter");
  await expect(total).toHaveText(/^[\d.]+(K|M|B)$/);
  await total.blur();
  // The cards and the sheet name the currency; the sparkline shows last year against the new year.
  await expect(page.getByTestId("bcards-revenue")).toContainText("(EGP)");
  await expect(page.locator("[data-testid^=bsheet-row-]").first().locator("td").last().locator("svg path")).toHaveCount(2);
  for (const k of ["revenue", "customers", "streams", "groups", "expenses", "vs"]) {
    await page.getByTestId(`btab-${k}`).click();
    await expect(page.getByTestId(`bchart-${k}`)).toBeVisible();
  }
  await page.getByTestId("btab-customers").click();
  await expect(page.getByTestId("bchart-top5")).toContainText("%");
  // Expenses by group, each group its own colour.
  await page.getByTestId("btab-expenses").click();
  const swatches = await page.getByTestId("bchart-expenses").locator("li i").evaluateAll((els) => els.map((e) => (e as HTMLElement).style.background));
  expect(swatches.length).toBeGreaterThan(2);
  expect(new Set(swatches).size).toBe(swatches.length);
  // Sort by the new year: the largest row first.
  await page.getByTestId("bsheet-sort-amount").click();
  const values = await page.locator("[data-testid^=bsheet-value-]").evaluateAll((els) => els.map((e) => Number((e.getAttribute("title") ?? "").replace(/,/g, ""))));
  expect(values.length).toBeGreaterThan(2);
  expect(values[0]).toBe(Math.max(...values));
  expect(values).toEqual([...values].sort((a, b) => b - a));
  // Search (a list of more than 15 rows) filters them.
  const rows = page.locator("[data-testid^=bsheet-row-]");
  const before = await rows.count();
  if (before > 15) {
    const name = (await rows.first().locator("td").first().innerText()).trim().split("\n")[0];
    await page.getByTestId("bsheet-search").fill(name.slice(0, 6));
    await expect.poll(() => rows.count()).toBeLessThan(before);
    await expect(rows.first()).toContainText(name.slice(0, 6));
  }
});

const nonZero = (t: string | null) => /[1-9]/.test(t ?? "");

test("the demo builder: groups Hospitals and Homecare, a rental stream, customers that add up", async ({ page }) => {
  await page.goto("/demo/planning/budget");
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
    await page.goto("/demo/planning/budget");
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

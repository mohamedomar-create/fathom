import { expect, test } from "@playwright/test";
import path from "node:path";

const PAGES = ["summary", "analysis/kpis", "analysis/explorer", "analysis/profitability", "analysis/cashflow", "analysis/growth", "analysis/trend", "analysis/goalseek", "analysis/financials"];

test("landing page leads to the demo", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("cta-demo").click();
  await expect(page).toHaveURL(/\/demo\/summary/);
  await expect(page.getByTestId("headline")).toContainText("EGP 1,066,138");
});

for (const p of PAGES) {
  test(`demo ${p} renders without errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`/demo/${p}`);
    await expect(page.locator("h1")).toBeVisible();
    await page.waitForTimeout(400);
    expect(errors).toEqual([]);
  });
}

test("period picker switches to a quarter and the numbers change", async ({ page }) => {
  await page.goto("/demo/analysis/profitability");
  const before = await page.getByTestId("tile-gp").innerText();
  await page.getByTestId("period-type").click();
  await page.getByRole("button", { name: "Quarter", exact: true }).click();
  await expect(page).toHaveURL(/type=quarter/);
  await expect(page.getByTestId("tile-gp")).not.toHaveText(before);
  await expect(page.getByTestId("period-picker")).toContainText("Q3 2026");
});

test("KPI detail modal opens with explanation and chart", async ({ page }) => {
  await page.goto("/demo/analysis/kpis");
  await page.getByTestId("kpi-gpm").click();
  await expect(page.getByRole("dialog")).toContainText("For each EGP100 in sales");
  await expect(page.getByRole("dialog").locator("svg").first()).toBeVisible();
});

test("goalseek lever changes move the NOW marker", async ({ page }) => {
  await page.goto("/demo/analysis/goalseek");
  const marker = page.getByTestId("now-marker");
  const before = await marker.innerText();
  await page.getByLabel("Price change %").fill("3");
  await expect(marker).not.toHaveText(before);
});

test("Odoo export importer maps and balances a real file", async ({ page }) => {
  await page.goto("/demo/settings/source-data");
  await page.getByTestId("file-input").setInputFiles(path.join(__dirname, "../fixtures/files/odoo-pl-bs.xlsx"));
  await expect(page.getByTestId("review")).toContainText("36 / 36");
  await expect(page.getByTestId("review")).toContainText("Balances");
  await expect(page.getByTestId("review")).toContainText("EGP 1,066,138");
  await expect(page.getByTestId("file-reading")).toContainText("Profit and Loss: 28 lines");
});

test("demo report downloads as a PDF", async ({ page }) => {
  test.slow();
  await page.goto("/demo/reports");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-pdf").click()]);
  expect(dl.suggestedFilename()).toMatch(/\.pdf$/);
});

test("app routes require sign-in", async ({ page }) => {
  await page.goto("/companies");
  await expect(page).toHaveURL(/\/login\?next=%2Fcompanies/);
  await expect(page.getByTestId("login-form")).toBeVisible();
});

test("data health shows loaded months, checks and sources", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/demo/settings/data-health");
  await expect(page.getByTestId("health-calendar")).toBeVisible();
  await expect(page.getByTestId("failed-count")).toContainText("0");
  const cell = page.locator('[data-status="ok"]').first();
  await cell.click();
  await expect(page.getByTestId("month-detail")).toContainText("Demo data");
  expect(errors).toEqual([]);
});

test("a financials figure opens the accounts behind it", async ({ page }) => {
  await page.goto("/demo/analysis/financials");
  await page.getByTestId("trace-gross_profit").click();
  const d = page.getByTestId("source-drawer");
  await expect(d).toContainText("Gross Profit");
  await expect(d).toContainText("Demo data");
  await expect(d).toContainText("(−)");
});

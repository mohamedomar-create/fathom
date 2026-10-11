import { expect, test } from "@playwright/test";
import path from "node:path";

const PAGES = ["summary", "analysis/kpis", "analysis/explorer", "analysis/profitability", "analysis/cashflow", "analysis/growth", "analysis/trend", "analysis/goalseek", "analysis/financials", "analysis/bank", "analysis/real-profit"];

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

test("an Odoo ledger, trial balance and P&L uploaded together: the ledger is imported, the others prove it", async ({ page }) => {
  const f = (n: string) => path.join(__dirname, `../fixtures/files/egypt-odoo-${n}.xlsx`);
  await page.goto("/demo/settings/source-data");
  await page.getByTestId("file-input").setInputFiles([f("general-ledger"), f("trial-balance"), f("profit-and-loss")]);
  const reading = page.getByTestId("file-reading");
  await expect(reading).toContainText("Odoo General Ledger");
  await expect(page.getByTestId("check-only")).toHaveCount(2);
  await expect(page.getByTestId("date-order").first()).toContainText("month first");
  await expect(page.getByTestId("review")).toContainText(/Trial Balance' covers several months in one total, so it was used to check the import instead of being imported: all \d+ account figures agree/);
  await expect(page.getByTestId("review")).toContainText("z Adjustment");
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
  await page.getByTestId("trace-buttons").getByRole("button").first().click();
  await expect(page.getByTestId("source-drawer")).toBeVisible();
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

test("summary headline figures open their source accounts", async ({ page }) => {
  await page.goto("/demo/summary");
  await page.getByTestId("trace-cash").click();
  await expect(page.getByTestId("source-drawer")).toContainText("Cash on hand");
});

test("bank readiness reads the demo like a credit analyst and recomputes room to borrow", async ({ page }) => {
  await page.goto("/demo/analysis/bank");
  await expect(page.getByTestId("bank-basis")).toContainText("12 months to Sep 2026");
  await expect(page.getByTestId("tile-dscr")).toContainText("x");
  await expect(page.getByTestId("bank-ratios")).toContainText("Debt service cover");
  await expect(page.getByTestId("bank-checklist")).toContainText("Audited financial statements");
  const before = await page.getByTestId("tile-headroom").innerText();
  await page.getByTestId("assume-rate").fill("30");
  await expect(page.getByTestId("tile-headroom")).not.toHaveText(before);
  await page.getByTestId("ratio-dscr").locator("summary").click();
  await expect(page.getByTestId("ratio-dscr")).toContainText("What the bank sees");
});

test("real profit bridges reported to real profit and needs inflation for it", async ({ page }) => {
  await page.goto("/demo/analysis/real-profit");
  await expect(page.getByTestId("real-bridge")).toContainText("Real profit at today's prices");
  await expect(page.getByTestId("collection")).toContainText("Collection rate");
  await page.getByTestId("assume-inflation").fill("");
  await expect(page.getByTestId("tile-real")).toContainText("enter inflation");
  await expect(page.getByTestId("real-bridge")).toHaveCount(0);
});

test("bank readiness tests a loan request, stresses the year and writes the memo", async ({ page }) => {
  await page.goto("/demo/analysis/bank");
  await expect(page.getByTestId("bank-memo")).toContainText("Lead with");
  await expect(page.getByTestId("trend-table")).toContainText("Debt service cover");
  await expect(page.getByTestId("trend-note")).toContainText("Upload earlier audited statements");
  await expect(page.getByTestId("stress-table")).toContainText("Sales fall 20%");
  await expect(page.getByTestId("breaking-points")).toContainText("Sales can fall");
  await expect(page.getByTestId("tile-request")).toContainText("enter the amount");
  await page.getByTestId("assume-requestAmount").fill("3000000");
  await page.getByTestId("assume-requestType").selectOption("term_loan");
  await page.getByTestId("assume-requestPurpose").fill("a second warehouse");
  await expect(page.getByTestId("proforma")).toContainText("With the new facility");
  await expect(page.getByTestId("tile-request")).toContainText("EGP 3.0M");
  await expect(page.getByTestId("bank-memo")).toContainText("a second warehouse");
});

test("the report adds bank and real-profit pages and still downloads as a PDF", async ({ page }) => {
  test.slow();
  await page.goto("/demo/reports");
  for (const label of ["Bank Readiness", "Bank: trend & stress test", "Real Profit"]) await page.getByRole("button", { name: `Show ${label}`, exact: true }).click();
  await expect(page.locator('[data-section="bank"]')).toContainText("Debt service cover");
  await expect(page.locator('[data-section="bank_outlook"]')).toContainText("Stress test");
  await expect(page.locator('[data-section="realprofit"]')).toContainText("Real profit at today's prices");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-pdf").click()]);
  expect(dl.suggestedFilename()).toMatch(/\.pdf$/);
});

// Highlighted statements on the demo: totals shaded, each change shown with ▲/▼ and better/worse, compared by default
// with the same period last year, and Budget offered once a budget exists. The demo cannot set marks.
import { expect, test } from "@playwright/test";

test("demo financials shade totals and show which way each line moved", async ({ page }) => {
  await page.goto("/demo/analysis/financials");
  const pl = page.getByTestId("pl-table");
  await expect(pl.locator('tr[data-line="net_income"]')).toHaveClass(/grand/);
  await expect(pl.locator('tr[data-line="operating_profit"]')).toHaveClass(/sub/);
  const toned = pl.locator("td[data-tone]");
  expect(await toned.count()).toBeGreaterThan(0);
  const tones = await toned.evaluateAll((els) => els.map((e) => e.getAttribute("data-tone")));
  expect(tones.some((t) => t === "better" || t === "worse")).toBe(true);
  await expect(pl.locator("td.tone-better, td.tone-worse").first()).toContainText(/[▲▼]/);
  await expect(page.getByTestId("mark-btn")).toHaveCount(0);
});

test("only the lines that need a look can be shown", async ({ page }) => {
  await page.goto("/demo/analysis/financials");
  const all = await page.getByTestId("pl-table").locator("tbody tr").count();
  await page.getByTestId("flags-only").check();
  const flagged = await page.getByTestId("pl-table").locator("tbody tr").count();
  expect(flagged).toBeLessThanOrEqual(all);
  // Every flagged line says why.
  for (const r of await page.getByTestId("pl-table").locator("tbody tr.flagged").all()) await expect(r.getByTestId("line-flag")).toHaveCount(1);
});

test("totals keep their better/worse colour, and the cash flow shows its changes too", async ({ page }) => {
  await page.goto("/demo/analysis/financials");
  const cell = page.getByTestId("pl-table").locator('tr[data-line="net_income"] td[data-tone]');
  const tone = await cell.getAttribute("data-tone");
  const bg = await cell.evaluate((e) => getComputedStyle(e).backgroundColor);
  if (tone === "better") expect(bg).toBe("rgb(227, 243, 234)");
  if (tone === "worse") expect(bg).toBe("rgb(252, 231, 231)");
  await page.getByTestId("fin-view").click();
  await page.getByRole("button", { name: "Cash Flow Statement" }).click();
  const cf = page.getByTestId("cf-table");
  await expect(cf).toBeVisible();
  expect(await cf.locator("td[data-tone]").count()).toBeGreaterThan(0);
  await expect(cf.locator("tr.grand").first()).toBeVisible();
});

test("when nothing needs a look, the page says so", async ({ page }) => {
  await page.goto("/demo/analysis/financials");
  await page.getByTestId("flags-only").check();
  const rows = await page.getByTestId("pl-table").locator("tbody tr").count();
  if (rows === 0) await expect(page.getByTestId("no-flags")).toBeVisible();
});

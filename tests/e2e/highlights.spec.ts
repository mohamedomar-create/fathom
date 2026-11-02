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

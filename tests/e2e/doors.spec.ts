// Phase 4a: the landing page has two doors, each to its own demo; the cash book demo works signed out and is read-only.
import { expect, test } from "@playwright/test";

test("the cash book door opens the public cash book demo, read-only, with no sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("doors")).toBeVisible();
  await page.getByTestId("door-cash").click();
  await expect(page).toHaveURL(/\/demo\/cash$/);
  await expect(page.getByTestId("cash-demo-badge")).toBeVisible();
  await expect(page.getByTestId("cash-name")).toContainText("Corner Kiosk");
  await expect(page.locator("main")).toContainText(/Money in/);
  await page.goto("/demo/cash/entries");
  await expect(page.getByTestId("entries-view-only")).toBeVisible();
  await expect(page.getByTestId("entries-add-row")).toHaveCount(0);
  for (const p of ["in", "out", "cash"]) expect((await page.goto(`/demo/cash/${p}`))?.status()).toBe(200);
  expect((await page.goto("/demo/cash/upload"))?.status()).toBe(404);
});

test("the accounting-system door opens the demo company", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("cta-demo").click();
  await expect(page).toHaveURL(/\/demo\/summary/);
});

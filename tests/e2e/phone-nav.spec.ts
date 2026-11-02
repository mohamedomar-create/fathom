// Phase 4a: on a phone every company page is reachable from the bottom bar, including from Data, Settings and
// Reports (no dead ends), and Financials' pages come in four headed groups.
import { expect, test } from "@playwright/test";

test.describe("phone bottom bar", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1440) >= 768, "phones only");

  test("Home, Sales and Expenses are one tap away, and the Pages sheet shows Financials' four groups", async ({ page }) => {
    await page.goto("/demo/analysis/kpis");
    const bar = page.getByTestId("bottom-bar");
    await expect(bar).toBeVisible();
    await expect(page.getByTestId("sector-financials")).toHaveAttribute("aria-current", "page");
    await page.getByTestId("bottom-pages").click();
    const sheet = page.getByTestId("bottom-sheet");
    for (const h of ["Overview", "Performance", "Cash & statements", "Plan"]) await expect(sheet).toContainText(h);
    await sheet.getByTestId("sheet-forecast").click();
    await expect(page).toHaveURL(/\/demo\/analysis\/forecast/);
    await page.getByTestId("sector-expenses").click();
    await expect(page).toHaveURL(/\/demo\/expenses/);
  });

  for (const start of ["/demo/data", "/demo/settings/profile", "/demo/reports"]) {
    test(`from ${start} the More sheet reaches another sector`, async ({ page }) => {
      await page.goto(start);
      await expect(page.getByTestId("bottom-bar")).toBeVisible();
      await expect(page.getByTestId("bottom-pages")).toHaveCount(0);
      await page.getByTestId("bottom-more").click();
      await page.getByTestId("more-sector-inventory").click();
      await expect(page).toHaveURL(/\/demo\/inventory/);
      await expect(page.getByTestId("bottom-pages")).toBeVisible();
    });
  }

  for (const [start, bar] of [["/demo/settings/kpis", "settings-save-bar"], ["/demo/settings/chart-of-accounts", "settings-save-bar"]] as const) {
    test(`on ${start} the sticky Save bar sits above the bottom bar, not under it`, async ({ page }) => {
      await page.goto(start);
      const save = page.getByTestId(bar).first();
      await expect(save).toBeVisible();
      const s = (await save.boundingBox())!, b = (await page.getByTestId("bottom-bar").boundingBox())!;
      expect(s.y + s.height).toBeLessThanOrEqual(b.y + 1);
    });
  }

  test("the bar never covers the end of the page", async ({ page }) => {
    await page.goto("/demo/summary");
    // Measured only once the bar is on screen: on a slow machine it is not laid out straight after navigation.
    await expect(page.getByTestId("bottom-bar")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const main = await page.locator("main").boundingBox();
    const bar = await page.getByTestId("bottom-bar").boundingBox();
    const pad = await page.locator("main").evaluate((m) => parseFloat(getComputedStyle(m).paddingBottom));
    expect(pad).toBeGreaterThanOrEqual(bar!.height);
    expect(main).toBeTruthy();
  });
});

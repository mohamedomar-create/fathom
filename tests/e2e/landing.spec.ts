import { expect, test } from "@playwright/test";

test("the landing page shows the product: hero with live figures, glass dashboards, real screenshots, every feature", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  for (const id of ["hero-stats", "hero-dashboard", "showcase", "checks", "bento", "how", "final-cta"]) await expect(page.getByTestId(id)).toBeVisible();
  // The floating cards are real figures from the demo company, not placeholders.
  for (const id of ["glass-revenue", "glass-cash", "glass-value", "glass-doctor"]) await expect(page.getByTestId(id)).toContainText(/\d/);
  // Screenshots of the real product, each described for screen readers.
  const shots = page.getByTestId("showcase").locator("img");
  expect(await shots.count()).toBeGreaterThanOrEqual(4);
  for (const img of await shots.all()) expect((await img.getAttribute("alt"))?.length ?? 0).toBeGreaterThan(10);
  await page.getByTestId("showcase-tab-valuation").click();
  await expect(page.getByTestId("showcase-active")).toHaveAttribute("data-shot", "valuation");
  // The two doors and sign-up stay.
  for (const id of ["door-cash", "cta-demo", "door-signup"]) await expect(page.getByTestId(id)).toBeVisible();
});

test("Arabic visitors see the Arabic screenshots", async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: "lang", value: "ar", url: baseURL! }]);
  await page.goto("/");
  const src = await page.getByTestId("showcase-active").locator("img").getAttribute("src");
  expect(src).toMatch(/-ar/);
});

test("with reduced motion the figures show their final values at once", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("/");
  const stat = page.getByTestId("hero-stats").locator("[data-final]").first();
  await expect(stat).toHaveText((await stat.getAttribute("data-final"))!);
  await ctx.close();
});

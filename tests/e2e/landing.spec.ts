import { expect, test } from "@playwright/test";

test("the landing page shows the product: hero with live figures, glass dashboards, real screenshots, every feature", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  for (const id of ["hero-stats", "hero-dashboard", "live-dashboard", "showcase", "checks", "bento", "flow", "who", "how", "final-cta"]) await expect(page.getByTestId(id)).toBeVisible();
  // The floating cards are real figures from the demo company, not placeholders.
  for (const id of ["glass-revenue", "glass-profit", "glass-cash", "glass-value", "glass-doctor"]) await expect(page.getByTestId(id)).toContainText(/\d/);
  // Screenshots of the real product, each described for screen readers.
  const shots = page.getByTestId("showcase").locator("img");
  expect(await shots.count()).toBeGreaterThanOrEqual(4);
  for (const img of await shots.all()) expect((await img.getAttribute("alt"))?.length ?? 0).toBeGreaterThan(10);
  await page.getByTestId("showcase-tab-valuation").click();
  await expect(page.getByTestId("showcase-active")).toHaveAttribute("data-shot", "valuation");
  // A drawn dashboard never shows a raw decimal or NaN.
  await expect(page.getByTestId("live-dashboard")).not.toContainText(/NaN|\d\.\d{4,}/);
  // On a wide screen the cash book sits on a phone beside the laptop.
  if ((page.viewportSize()?.width ?? 0) >= 1024) await expect(page.getByTestId("showcase-phone")).toBeVisible();
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

test("on a phone the readiness card's next step gets a readable width, not a squeezed column", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/demo");
  const next = page.locator('[data-testid^="readiness-next-"]').first();
  await expect(next).toBeVisible();
  expect((await next.boundingBox())!.width).toBeGreaterThanOrEqual(224);
});

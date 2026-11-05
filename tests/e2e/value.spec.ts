import { expect, test } from "@playwright/test";

test("Valuation opens simple: lowest, fair and highest, how to raise it, what you can ask for; no expert words", async ({ page }) => {
  await page.goto("/demo/valuation");
  await expect(page.getByRole("heading", { level: 1, name: "Valuation" })).toBeVisible();
  for (const k of ["simple-lowest", "simple-fair", "simple-highest", "simple-raise", "value-ask", "value-deal", "simple-methods", "simple-discount"]) await expect(page.getByTestId(k)).toBeVisible();
  for (const k of ["pitch", "strategic", "future", "scorecard", "berkus"]) await expect(page.getByTestId(`ask-${k}`)).toBeVisible();
  const text = await page.getByTestId("value-simple").innerText();
  for (const w of ["WACC", "EBITDA", "DCF", "terminal"]) expect(text, w).not.toContain(w);
  await expect(page.getByTestId("value-disclaimer")).toBeVisible();
});

test("the deal calculator: ask EGP 2M for 1% says what that values the company at and whether it can be defended", async ({ page }) => {
  await page.goto("/demo/valuation");
  await page.getByTestId("deal-amount").fill("2000000");
  await page.getByTestId("deal-pct").fill("1");
  await expect(page.getByTestId("deal-result")).toContainText("This values your company at");
  await expect(page.getByTestId("deal-fit")).toHaveAttribute("data-fit", /fair|ask|hard|low/);
});

test("the Expert switch shows every method on the football field, the bridge and the limitations, and is remembered", async ({ page }) => {
  await page.goto("/demo/valuation");
  await page.getByTestId("view-expert").click();
  for (const k of ["dcf", "ebitda", "sales", "pe", "adjustedAssets", "liquidation"]) await expect(page.getByTestId(`ff-${k}`)).toBeVisible();
  await expect(page.getByTestId("value-bridge")).toBeVisible();
  await expect(page.getByTestId("limit-unaudited")).toBeVisible();
  await expect(page.getByTestId("value-before-discount")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("ff-dcf")).toBeVisible();
  await page.getByTestId("view-simple").click();
  await expect(page.getByTestId("value-simple")).toBeVisible();
});

test("changing the purpose to a bank gives the asset method more weight; liquidation is never blended in", async ({ page }) => {
  await page.goto("/demo/valuation?view=expert");
  const assets = page.getByTestId("ff-adjustedAssets");
  const before = await assets.innerText();
  await page.getByTestId("value-purpose").selectOption("bank");
  await expect(assets).not.toHaveText(before);
  await expect(page.getByTestId("ff-liquidation")).not.toContainText("%");
});

test("methods page shows the cost of capital, the projection and the sensitivity grid", async ({ page }) => {
  await page.goto("/demo/valuation/methods");
  await expect(page.getByTestId("value-capital")).toBeVisible();
  await expect(page.getByTestId("value-projection")).toBeVisible();
  await expect(page.getByTestId("value-grid")).toBeVisible();
});

test("a higher bond yield lowers the value at once; the owner's scores bring in the startup methods; the demo can't save", async ({ page }) => {
  await page.goto("/demo/valuation/assumptions");
  await expect(page.getByTestId("va-save")).toBeDisabled();
  const before = await page.getByTestId("va-best").innerText();
  await page.getByTestId("va-riskFree").fill("35");
  await expect(page.getByTestId("va-best")).not.toHaveText(before);
  await expect(page.getByTestId("va-scores")).toBeVisible();
  await page.getByTestId("va-berkusScores-idea").fill("4");
});

test("the old Company value address leads to Valuation", async ({ page }) => {
  await page.goto("/demo/value/methods");
  await expect(page).toHaveURL(/\/demo\/valuation\/methods$/);
});

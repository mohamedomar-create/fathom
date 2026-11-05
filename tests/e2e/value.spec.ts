import { expect, test } from "@playwright/test";

test("demo company value: best estimate, every method on the football field, the bridge and the limitations", async ({ page }) => {
  await page.goto("/demo/value");
  await expect(page.getByTestId("value-best")).toBeVisible();
  for (const k of ["dcf", "ebitda", "sales", "pe", "adjustedAssets", "liquidation"]) await expect(page.getByTestId(`ff-${k}`)).toBeVisible();
  await expect(page.getByTestId("value-bridge")).toBeVisible();
  await expect(page.getByTestId("limit-unaudited")).toBeVisible();
  await expect(page.getByTestId("value-disclaimer")).toBeVisible();
});

test("changing the purpose to a bank brings liquidation into the estimate", async ({ page }) => {
  await page.goto("/demo/value");
  const liq = page.getByTestId("ff-liquidation");
  await expect(liq).not.toContainText("%");
  await page.getByTestId("value-purpose").selectOption("bank");
  await expect(liq).toContainText("%");
});

test("methods page shows the cost of capital, the projection and the sensitivity grid", async ({ page }) => {
  await page.goto("/demo/value/methods");
  await expect(page.getByTestId("value-capital")).toBeVisible();
  await expect(page.getByTestId("value-projection")).toBeVisible();
  await expect(page.getByTestId("value-grid")).toBeVisible();
});

test("a higher bond yield lowers the value at once; the demo can't save", async ({ page }) => {
  await page.goto("/demo/value/assumptions");
  await expect(page.getByTestId("va-save")).toBeDisabled();
  const before = await page.getByTestId("va-best").innerText();
  await page.getByTestId("va-riskFree").fill("35");
  await expect(page.getByTestId("va-best")).not.toHaveText(before);
});

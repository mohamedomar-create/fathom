import { expect, test } from "@playwright/test";
import { createCompany, importFiles, newEmail, requireLocalStack, signUp } from "./helpers";

requireLocalStack();

test("a new user's first screen is not a warning, and on a phone the companies and people pages never scroll sideways", async ({ page }) => {
  test.slow();
  await signUp(page, { name: "Phone Owner", org: "Delta Trading", email: newEmail("phone") });
  // No company yet: nothing to protect, so no two-step sign-in warning greets them.
  await page.goto("/companies");
  await expect(page.getByTestId("mfa-banner")).toHaveCount(0);
  const id = await createCompany(page, "Delta Retail");
  await importFiles(page, id, ["odoo-pl-bs.xlsx"]);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/companies", "/admin/people"]) {
    await page.goto(path);
    await expect(page.locator("h1").first()).toBeVisible();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over, `${path} overflows by ${over}px`).toBeLessThanOrEqual(0);
  }
  // Once there is a company, the reminder is back.
  await page.goto("/companies");
  await expect(page.getByTestId("mfa-banner")).toBeVisible();
});

import { expect, test } from "@playwright/test";

test("privacy policy and terms are public and linked", async ({ page }) => {
  for (const [path, heading] of [["/privacy", "Privacy policy"], ["/terms", "Terms of use"]] as const) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByText("ReportY").first()).toBeVisible();
  }
  await page.goto("/");
  await page.getByRole("navigation", { name: "Legal" }).getByRole("link", { name: "Privacy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await page.goto("/login?mode=signup");
  await expect(page.getByTestId("signup-legal")).toContainText("Terms");
});

test("the account page needs a sign-in", async ({ page }) => {
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login\?next=%2Faccount/);
});

test("data exports need a sign-in", async ({ request }) => {
  expect((await request.get("/api/export/me")).status()).toBe(401);
  expect((await request.get("/api/export/2b1f7c58-1d4e-4c8a-9a51-0d2b7d0c9e11")).status()).toBe(401);
  expect((await request.get("/api/export/not-a-uuid")).status()).toBe(404);
});

test("the home page confirms a deleted account", async ({ page }) => {
  await page.goto("/?account=deleted");
  await expect(page.getByTestId("account-deleted")).toBeVisible();
  await page.goto("/");
  await expect(page.getByTestId("account-deleted")).toHaveCount(0);
});

test("sign-up asks for a strong password before contacting the server", async ({ page }) => {
  await page.goto("/login?mode=signup");
  await page.getByLabel("Email").fill("someone@example.com");
  await page.getByLabel("Password").fill("abcdefghij");
  await page.getByRole("button", { name: "Create account" }).last().click(); // the first one is the mode tab
  await expect(page.getByRole("status")).toContainText("letters and numbers");
});

import { expect, test } from "@playwright/test";
import { newEmail, requireLocalStack, signUp } from "./helpers";

requireLocalStack();

test("the health check answers for the uptime monitor, with no data and no sign-in", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({ ok: true, db: true, schema: 40, required: 40 });
  // Nothing but the state: no company, user or configuration data.
  for (const k of Object.keys(body)) expect(["ok", "db", "schema", "required", "commit", "time"]).toContain(k);
});

test("the owner sees this month's AI use and sets the allowance", async ({ page }) => {
  await signUp(page, { name: "Aya Allowance", org: "Allowance Advisory", email: newEmail("ai") });
  await page.goto("/admin/organisation");
  const box = page.getByTestId("ai-allowance");
  await expect(box).toContainText("used $0.00 of $20 this month");
  await box.getByTestId("ai-limit").fill("35");
  await box.getByTestId("ai-save").click();
  await expect(box.getByRole("status")).toContainText("Allowance saved.");
  await page.reload();
  await expect(page.getByTestId("ai-allowance")).toContainText("of $35 this month");
});

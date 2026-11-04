// Security and access (0057): an admin limits a member in one company (view only, or no access at all); someone who
// runs two organisations picks which one the admin pages manage; changing a password needs the current one.
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { createCompany, localEnv, newEmail, PASSWORD, requireLocalStack, signIn, signUp } from "./helpers";

requireLocalStack();
const DB = localEnv("LOCAL_DB_URL") || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-Atq", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" }).trim();

test("an admin makes an editor view-only in one company and hides another from them", async ({ page, browser }) => {
  test.slow();
  await signUp(page, { name: "Amal Admin", org: "Access Advisory", email: newEmail("acadmin") });
  const a = await createCompany(page, "Access Alpha");
  const b = await createCompany(page, "Access Beta");
  const ctx = await browser.newContext();
  const ed = await ctx.newPage();
  const eEmail = newEmail("aceditor");
  await signUp(ed, { name: "Emad Editor", org: "Emad Home", email: eEmail });
  sql(`insert into public.memberships (org_id, user_id, role) select c.org_id, u.id, 'editor' from public.companies c, auth.users u where c.id = '${a}' and u.email = '${eEmail}'`);

  await page.goto("/admin/people");
  const person = page.getByTestId("company-access-person").filter({ hasText: eEmail });
  await person.locator("summary").click();
  await person.getByTestId(`access-${a}`).selectOption("viewer");
  await expect(person.getByRole("status")).toHaveText("Saved");
  await person.getByTestId(`access-${b}`).selectOption("none");
  await expect(person.getByTestId(`access-${b}`)).toHaveValue("none");

  // The editor now only views Alpha, and Beta is gone from their list and their reach.
  await ed.goto(`/company/${a}/settings/profile`);
  await expect(ed.locator('input[name="name"], input').first()).toBeDisabled();
  await ed.goto("/companies");
  await expect(ed.getByText("Access Alpha")).toBeVisible();
  await expect(ed.getByText("Access Beta")).toHaveCount(0);
  const gone = await ed.goto(`/company/${b}/summary`);
  expect(gone?.status()).toBe(404);
  await ctx.close();
});

test("someone who runs two organisations picks which one the admin pages manage", async ({ page }) => {
  const email = newEmail("twoorgs");
  await signUp(page, { name: "Tariq Two", org: "First Org Two", email });
  sql(`with o as (insert into public.organizations (name) values ('Second Org Two') returning id)
       insert into public.memberships (org_id, user_id, role) select o.id, u.id, 'admin' from o, auth.users u where u.email = '${email}'`);
  await page.goto("/admin/organisation");
  const pick = page.getByTestId("admin-org-picker");
  await expect(pick).toBeVisible();
  const second = await pick.locator("option", { hasText: "Second Org Two" }).getAttribute("value");
  await pick.selectOption(second!);
  await expect(page.locator("input").first()).toHaveValue("Second Org Two", { timeout: 15_000 });
});

test("changing the password needs the current one", async ({ page }) => {
  const email = newEmail("pwchange");
  await signUp(page, { name: "Pia Password", org: "Pw Org", email });
  await page.goto("/account");
  await page.getByTestId("pw-current").fill("not-my-password-1");
  await page.getByLabel("New password").fill("a-brand-new-pass-77");
  await page.getByLabel(/Repeat/).fill("a-brand-new-pass-77");
  await page.getByRole("button", { name: /Change password/ }).click();
  await expect(page.getByText("The current password is not right.")).toBeVisible();
  await page.getByTestId("pw-current").fill(PASSWORD);
  await page.getByRole("button", { name: /Change password/ }).click();
  await expect(page.getByText(/Password changed/)).toBeVisible();
  await page.context().clearCookies();
  await signIn(page, email, "a-brand-new-pass-77");
  await expect(page).toHaveURL(/\/companies/);
});

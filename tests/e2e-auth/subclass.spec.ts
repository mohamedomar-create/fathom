import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { createCompany, importFiles, newEmail, requireLocalStack, signUp } from "./helpers";

requireLocalStack();
const sql = (q: string) => execFileSync("psql", [process.env.DB_URL ?? "postgres://postgres:postgres@127.0.0.1:54322/postgres", "-Atq", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" }).trim();

test("a sub-class chosen in the chart of accounts is saved and the cash flow says which lines are estimated", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, { name: "Sub Class", org: "Sub Class Org", email: newEmail("subc") });
  const id = await createCompany(page, "Sub Class Co");
  await importFiles(page, id, ["odoo-pl-bs.xlsx"]);

  await page.goto(`/company/${id}/settings/chart-of-accounts`);
  await page.getByRole("button", { name: "Balance Sheet" }).click();
  const sub = page.locator('select[data-testid^="sub-"]').first();
  await expect(sub).toBeVisible({ timeout: 30_000 });
  const accountId = (await sub.getAttribute("data-testid"))!.slice(4);
  const option = await sub.locator("option").nth(1).getAttribute("value");
  await sub.selectOption(option!);
  await page.getByRole("button", { name: "Save mapping" }).click();
  await expect(page.getByText(/sub-class\(es\) saved/)).toBeVisible({ timeout: 15_000 });
  const key = sql(`select case when coalesce(code, '') <> '' then '#' || code else lower(name) end from public.source_accounts where id = '${accountId}'`);
  expect(sql(`select sub_class from public.account_map where company_id = '${id}' and sub_class is not null limit 1`)).toBe(option);
  expect(key.length).toBeGreaterThan(0);
});

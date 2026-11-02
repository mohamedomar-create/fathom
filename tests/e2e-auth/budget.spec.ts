import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { createCompany, importFiles, newEmail, requireLocalStack, signUp } from "./helpers";

requireLocalStack();
const sql = (q: string) => execFileSync("psql", [process.env.DB_URL ?? "postgres://postgres:postgres@127.0.0.1:54322/postgres", "-Atq", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" }).trim();

test("a budget from last year + 10%: edited, approved and then locked; the template goes out and back", async ({ page }, info) => {
  test.setTimeout(180_000);
  await signUp(page, { name: "Budget Owner", org: "Budget Org", email: newEmail("budget") });
  const id = await createCompany(page, "Budget Co");
  await importFiles(page, id, ["odoo-pl-bs.xlsx"]);

  await page.goto(`/company/${id}/analysis/budget`);
  await expect(page.getByText("No budget yet")).toBeVisible();
  await page.getByTestId("budget-new").click();
  // Next year: last year is the year just loaded.
  const fy = await page.getByTestId("budget-fy").locator("option").nth(1).getAttribute("value");
  await page.getByTestId("budget-fy").selectOption(fy!);
  await page.getByTestId("budget-from-ly").check();
  await page.getByTestId("budget-pct").fill("10");
  await page.getByTestId("budget-create").click();
  await expect(page.getByTestId("budget-bar")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("budget-status")).toContainText("Draft");

  const v = sql(`select id from public.budget_versions where company_id = '${id}'`);
  // Each line is last year's same month × 1.1 (checked for every line against the stored balances).
  const off = sql(`
    with ly as (
      select '#' || s.code as key, to_char(to_date(b.period, 'YYYY-MM') + interval '1 year', 'YYYY-MM') as month,
             sum(case when s.class in ('revenue','other_income','interest_income') then -b.amount else b.amount end) as v
      from public.account_balances b join public.source_accounts s on s.id = b.account_id
      join public.companies c on c.id = s.company_id and c.data_version = s.version
      where c.id = '${id}' and coalesce(s.code, '') <> '' group by 1, 2)
    select count(*) || '/' || count(*) filter (where abs(l.amount - round(ly.v * 1.1, 2)) > 0.01)
    from public.budget_lines l join ly on ly.key = l.key and ly.month = l.month where l.version_id = '${v}'`);
  const [n, bad] = off.split("/");
  expect(Number(n)).toBeGreaterThan(0);
  expect(bad).toBe("0");

  // Edit one cell and save it.
  await page.getByTestId("budget-tab-accounts").click();
  const cell = page.locator("[data-testid^=budget-cell-]").first();
  const tid = (await cell.getAttribute("data-testid"))!;
  const [key, month] = tid.replace("budget-cell-", "").split(/-(?=\d{4}-\d{2}$)/);
  await cell.fill("12345");
  await cell.blur();
  await page.getByTestId("budget-save").click();
  await expect(page.getByTestId("budget-msg")).toContainText("Saved", { timeout: 15_000 });
  expect(sql(`select amount from public.budget_lines where version_id = '${v}' and key = '${key}' and month = '${month}'`)).toBe("12345");

  // The template: download it, then upload it back (it replaces the draft's lines with the same lines).
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("budget-download").click()]);
  const file = info.outputPath("budget.xlsx");
  await dl.saveAs(file);
  const before = sql(`select count(*) || '/' || sum(amount) from public.budget_lines where version_id = '${v}'`);
  await page.getByTestId("budget-upload-input").setInputFiles(file);
  await expect(page.getByTestId("budget-msg")).toContainText("lines and", { timeout: 20_000 });
  expect(sql(`select count(*) || '/' || sum(amount) from public.budget_lines where version_id = '${v}'`)).toBe(before);

  // Approve: then nothing on the page can change it.
  await page.getByRole("button", { name: "Approve" }).first().click();
  await page.getByTestId("budget-approve").getByTestId("confirm-button").click();
  await expect(page.getByTestId("budget-status")).toContainText("Approved", { timeout: 15_000 });
  await page.getByTestId("budget-tab-accounts").click();
  await expect(page.locator("[data-testid^=budget-cell-]")).toHaveCount(0);
  await expect(page.getByTestId("budget-upload")).toHaveCount(0);
  expect(sql(`select status from public.budget_versions where id = '${v}'`)).toBe("approved");
});

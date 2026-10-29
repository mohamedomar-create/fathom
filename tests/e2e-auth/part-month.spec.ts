import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { createCompany, importFiles, newEmail, requireLocalStack, signUp } from "./helpers";

requireLocalStack();
const sql = (q: string) => execFileSync("psql", [process.env.DB_URL ?? "postgres://postgres:postgres@127.0.0.1:54322/postgres", "-Atq", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" }).trim();

test("a part month: pages open on the last full month; the part month shows its badge and a same-days comparison", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, { name: "Part Month", org: "Part Month Org", email: newEmail("part") });
  const id = await createCompany(page, "Part Month Co");
  await importFiles(page, id, ["odoo-pl-bs.xlsx"]);
  const months = sql(`select string_agg(distinct period, ',' order by period) from public.account_balances where company_id = '${id}'`).split(",");
  const last = months[months.length - 1], prev = months[months.length - 2];
  // The books run to the 10th of the last month.
  sql(`update public.imports set report = jsonb_set(coalesce(report, '{}'), '{asOf}', to_jsonb('${last}-10'::text)) where company_id = '${id}' and action = 'import'`);

  await page.goto(`/company/${id}`);
  const picker = page.getByTestId("period-picker");
  await expect(picker).toBeVisible({ timeout: 30_000 });
  const name = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  await expect(page.getByTestId("period-end")).toContainText(name(prev));
  await expect(page.getByTestId("part-month")).toHaveCount(0);

  await page.getByTestId("period-end").click();
  await page.getByTestId(`month-${last}`).click();
  await expect(page.getByTestId("part-month")).toContainText("10");
  await expect(page.getByText(/same 10 days/).first()).toBeVisible();
});

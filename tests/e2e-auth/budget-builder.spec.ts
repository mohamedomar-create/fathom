import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { createCompany, fixture, importFiles, newEmail, requireLocalStack, signUp, startUpload } from "./helpers";

requireLocalStack();
const sql = (q: string) => execFileSync("psql", [process.env.DB_URL ?? "postgres://postgres:postgres@127.0.0.1:54322/postgres", "-Atq", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" }).trim();

test("setup: top products ticked, a group created with a product and a customer, a rental product confirmed, two expenses merged; saved and reloaded the same", async ({ page }) => {
  test.setTimeout(240_000);
  await signUp(page, { name: "Builder Owner", org: "Builder Org", email: newEmail("builder") });
  const id = await createCompany(page, "Builder Co");
  await importFiles(page, id, ["odoo-pl-bs.xlsx"]); // the budget page needs financial data
  // A sales file (products and customers) and a vendor-bills file (expense accounts).
  await startUpload(page, id, "sales");
  await page.getByTestId("file-input").setInputFiles(fixture("odoo-invoice-analysis.xlsx"));
  await page.getByTestId("sales-next").click();
  await page.getByTestId("save-sales").click();
  await expect(page.getByTestId("done-step")).toBeVisible({ timeout: 30_000 });
  await startUpload(page, id, "expenses");
  await page.getByTestId("file-input").setInputFiles(fixture("odoo-vendor-bills.xlsx"));
  await page.getByTestId("expenses-next").click();
  await page.getByTestId("save-expenses").click();
  await expect(page.getByTestId("done-step")).toBeVisible({ timeout: 30_000 });

  // No setup yet and there are products: the wizard opens by itself.
  await page.goto(`/company/${id}/analysis/budget`);
  await expect(page.getByTestId("bsetup-step-1")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("bsetup-coverage")).toContainText("% of revenue");
  const products = page.locator("[data-testid^=bsetup-product-]");
  expect(await products.count()).toBeGreaterThan(0);
  await products.first().check();
  await page.getByTestId("bsetup-next").click();

  // Step 2: a new group with one product and one customer.
  await expect(page.getByTestId("bsetup-step-2")).toBeVisible();
  await page.getByTestId("bsetup-group-new").click();
  await page.getByTestId("bsetup-group-name").fill("Mixed group");
  await page.locator("[data-testid^=bsetup-member-][data-kind=product]").first().check();
  await page.locator("[data-testid^=bsetup-member-][data-kind=customer]").first().check();
  // A rental product: a suggested one, else marked by hand.
  const hint = page.locator("[data-testid^=bsetup-rental-]");
  if (await hint.count()) await hint.first().check();
  else await page.locator("[data-testid^=bsetup-markrental-]").first().check();
  await page.getByTestId("bsetup-next").click();

  // Step 3: merge the first two expense accounts.
  await expect(page.getByTestId("bsetup-step-3")).toBeVisible();
  await page.locator("[data-testid^=bsetup-exp-select-]").nth(0).check();
  await page.locator("[data-testid^=bsetup-exp-select-]").nth(1).check();
  await page.getByTestId("bsetup-exp-merge").click();
  await page.getByTestId("bsetup-exp-name").fill("Merged costs");
  await page.getByTestId("bsetup-exp-merge-ok").click();
  await page.getByTestId("bsetup-save").click();
  await expect(page.getByTestId("bsetup-step-3")).toHaveCount(0, { timeout: 20_000 });

  const row = () => JSON.parse(sql(`select setup from public.budget_setups where company_id = '${id}'`));
  const s = row();
  expect(s.products.length).toBeGreaterThan(0);
  const g = s.groups.find((x: { name: string }) => x.name === "Mixed group");
  expect(g.products.length).toBeGreaterThanOrEqual(1);
  expect(g.customers.length).toBeGreaterThanOrEqual(1);
  expect(s.streams.rental.length).toBeGreaterThan(0);
  expect(s.expenses.merged).toHaveLength(1);
  expect(s.expenses.merged[0].accounts).toHaveLength(2);
  expect(s.expenses.merged[0].name).toBe("Merged costs");

  // Reload and open the wizard again: the same choices are ticked.
  await page.reload();
  await expect(page.getByTestId("bsetup-step-1")).toHaveCount(0);
  await page.getByTestId("bsetup-open").click();
  await expect(page.getByTestId("bsetup-step-1")).toBeVisible();
  const ticked = await products.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).checked));
  expect(ticked.filter(Boolean).length).toBe(s.products.length);
  await page.getByTestId("bsetup-next").click();
  await expect(page.getByTestId("bsetup-groups")).toContainText("Mixed group");
});

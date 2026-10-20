import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { createCompany, newEmail, requireLocalStack, signUp } from "./helpers";

requireLocalStack();

const UPA = "الهيئة المصرية للشراء الموحد";
/** Synced invoice lines (as the Odoo sync saves them): agency lines with their order, contact or delivery link, and one with none. */
function seed(company: string) {
  const sql = `
    with b as (insert into public.sales_batches (company_id, source, periods, filename) values ('${company}', 'file', array['2026-08','2026-09'], 'Odoo (live sync)') returning id)
    insert into public.sales_lines (company_id, batch_id, source, day, period, doc, series, customer, product, category, salesperson, qty, amount, sale_order, end_user, map_method, note)
    select '${company}', b.id, 'file', d::date, left(d, 7), doc, 'INV2', c, 'Cannula', 'Consumables', '', 1, a, so, eu, mm, nt from b, (values
      ('2026-09-29', 'INV2/2026/0901', '${UPA}', 250000, 'S00010', 'مستشفى الشفاء العام', 'order', null),
      ('2026-09-09', 'INV2/2026/0903', '${UPA}', 120000, 'S00012', 'مستشفى النور التخصصي-الشراء الموحد', 'order', null),
      ('2026-08-20', 'INV2/2026/0904', '${UPA}', 80000, 'S00013', 'مستشفي النور التخصصى', 'order', null),
      ('2026-09-30', 'INV2/2026/0905', '${UPA}', 90000, null, 'مستشفى الأمل الجامعي-الشراء الموحد', 'order', null),
      ('2026-09-30', 'INV/2026/0101', '${UPA}', 30000, null, null, null, '( PRO 501 / 22 ) - [Device] Airtech AE-8'),
      ('2026-09-15', 'INV/2026/0102', 'Northside Hospital', 5000, null, null, null, 'CPAP')
    ) v(d, doc, c, a, so, eu, mm, nt);`;
  execFileSync("psql", [process.env.DB_URL ?? "postgres://postgres:postgres@127.0.0.1:54322/postgres", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql]);
}

test("agency sales placed on hospitals from exact links; an unlinked line stays Unmapped until the register places it", async ({ page }) => {
  await signUp(page, { name: "Agency Owner", org: "Agency Advisory", email: newEmail("eu") });
  const id = await createCompany(page, "Agency Co");
  seed(id);

  await page.goto(`/company/${id}/sales/end-users`);
  await expect(page.getByTestId("eu-agencies")).toContainText(UPA);
  await expect(page.getByTestId("eu-check")).toContainText("Every pound of agency sales is accounted for");
  // 540,000 of 570,000 placed by order links; 30,000 has no link.
  await expect(page.getByTestId("eu-coverage")).toContainText("94.7%");
  const table = page.getByTestId("eu-table");
  await expect(table.getByRole("row")).toHaveCount(4); // header + 3 hospitals: the two Assiut spellings are one
  await expect(table).toContainText("مستشفى النور التخصصي");
  await expect(table).not.toContainText("Northside");
  await expect(page.getByTestId("eu-unmapped-list")).toContainText("PRO 501 / 22");

  await page.goto(`/company/${id}/data/end-users`);
  await page.getByLabel("Order register lines").fill("PRO 501/22 = مستشفى الرحمة المركزي");
  await page.getByRole("button", { name: /Save 1 line/ }).click();
  await expect(page.getByRole("status")).toContainText("1 order number saved");
  await expect(page.getByTestId("register-table")).toContainText("مستشفى الرحمة المركزي");

  await page.goto(`/company/${id}/sales/end-users`);
  await expect(page.getByTestId("eu-coverage")).toContainText("100%");
  await expect(page.getByTestId("eu-unmapped-list")).toHaveCount(0);
  await expect(page.getByTestId("eu-table")).toContainText("مستشفى الرحمة المركزي");
});

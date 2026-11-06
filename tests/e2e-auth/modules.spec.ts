// The company's own modules, end to end: the areas picked at setup are the navigation; an HR export from SAP is read into
// the HR module (dated by its as-of day, admins-only by default, filtered by department); a CRM file offers to open its
// module; a table no module knows becomes a module of its own; and a viewer never sees HR, in the page or the database.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { newEmail, PASSWORD, requireLocalStack, signIn, signOut, signUp } from "./helpers";

requireLocalStack();
const sql = (q: string) => execFileSync("psql", [process.env.DB_URL ?? "postgres://postgres:postgres@127.0.0.1:54322/postgres", "-tAq", "-c", q]).toString().trim();

async function book(name: string, sheets: Record<string, unknown[][]>): Promise<string> {
  const XLSX = await import("@e965/xlsx");
  const wb = XLSX.utils.book_new();
  for (const [s, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), s);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mods-")), name);
  fs.writeFileSync(file, Buffer.from(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer));
  return file;
}

async function upload(page: Page, id: string, file: string) {
  await page.goto(`/company/${id}/data`);
  await page.getByTestId("intake-open").click();
  await page.getByTestId("intake-files").setInputFiles(file);
  await expect(page.getByTestId("intake-review")).toBeVisible();
}
async function saveAll(page: Page) {
  await expect(page.getByTestId("intake-next")).toBeEnabled();
  await page.getByTestId("intake-next").click();
  await page.getByTestId("intake-save").click();
  await expect(page.getByTestId("intake-done")).toBeVisible({ timeout: 60_000 });
}

test("modules follow the company: setup picks the areas, HR is admins-only, CRM opens on its file, a new table becomes a module", async ({ page }) => {
  test.setTimeout(180_000);
  const owner = newEmail("mods");
  await signUp(page, { name: "Mods Owner", org: "Mods Group", email: owner });
  // Setup: Financials, Sales, Warehouse and HR; no Expenses, Purchasing or Payments.
  await page.goto("/companies");
  await page.getByTestId("add-company").click();
  await page.getByTestId("tile-odoo").click();
  await page.getByTestId("odoo-files").click();
  await page.getByLabel("Company name").fill("Mods Co");
  for (const k of ["expenses", "purchasing", "payments"]) await page.getByTestId(`area-${k}`).locator("input").uncheck();
  await page.getByTestId("area-hr").locator("input").check();
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(/\/company\/[0-9a-f-]{36}\/data/);
  const id = page.url().match(/\/company\/([0-9a-f-]{36})/)![1];

  // The navigation is exactly what was picked.
  await page.goto(`/company/${id}`);
  const tabs = page.locator("header");
  await expect(tabs.getByRole("link", { name: "Sales", exact: true })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Inventory", exact: true })).toBeVisible();
  // HR, picked at setup, is a tab of its own (not tucked under one "Modules" tab).
  await expect(tabs.getByTestId("tab-mod_hr")).toHaveText("HR (employees)");
  await expect(tabs.getByRole("link", { name: "Modules", exact: true })).toHaveCount(0);
  await expect(tabs.getByRole("link", { name: "Expenses", exact: true })).toHaveCount(0);
  await expect(tabs.getByRole("link", { name: "Payments", exact: true })).toHaveCount(0);
  // Without the books, the home lists the modules on their own (none holds data yet).
  await expect(page.getByTestId("modules-home")).toBeVisible();
  // Every module guides the person like the built-in areas: steps per system, its own template, and the upload.
  await page.goto(`/company/${id}/modules/hr`);
  await expect(page.getByTestId("module-guide")).toBeVisible();
  await page.getByTestId("guide-sap").click();
  await expect(page.getByTestId("guide-steps")).toContainText("Spreadsheet");
  const tpl = await page.request.get(`/api/templates/module/hr?lang=en`);
  expect(tpl.status()).toBe(200);
  expect(tpl.headers()["content-type"]).toContain("spreadsheetml");
  await page.goto(`/company/${id}/data`);
  await expect(page.getByTestId("module-step-hr")).toBeVisible();

  // An SAP employee list: HR, waits for its as-of day, never dated by the hire date.
  await upload(page, id, await book("Staff.xlsx", { Employees: [
    ["Personnel Number", "Employee Name", "Org. Unit", "Position", "Hire Date", "Monthly Salary"],
    ["1001", "Mona Adel", "Sales", "Rep", "01/03/2019", 15000],
    ["1002", "Omar Ali", "Finance", "Accountant", "15/07/2021", 18000],
    ["1003", "Sara Nabil", "Sales", "Lead", "01/02/2020", 22000],
  ] }));
  const hr = page.getByTestId("intake-piece").first();
  await expect(hr).toHaveAttribute("data-module", "hr");
  await expect(page.getByTestId("intake-next")).toBeDisabled();
  await hr.getByTestId("intake-asof").fill("2026-10-31");
  await saveAll(page);

  await page.goto(`/company/${id}/modules/hr`);
  await expect(page.getByTestId("module-page")).toBeVisible();
  await expect(page.getByTestId("module-rows")).toContainText("3");
  await expect(page.getByTestId("module-total")).toContainText("55,000");
  await page.getByTestId("module-dim-department").getByText("Sales", { exact: true }).click();
  await expect(page.getByTestId("module-filters")).toContainText("Sales");
  await expect(page.getByTestId("module-total")).toContainText("37,000");
  await expect(page.getByTestId("module-table").locator("tbody tr")).toHaveCount(2);
  // A year of a snapshot list is the list at its latest month, never added up; a foreign ?end= opens its own latest month.
  await page.goto(`/company/${id}/modules/hr?type=year&end=2026-10`);
  await expect(page.getByTestId("module-rows")).toContainText("3");
  await page.goto(`/company/${id}/modules/hr?end=2019-01`);
  await expect(page.getByTestId("period-end")).toContainText("Oct");
  await expect(page.getByTestId("module-rows")).toContainText("3");

  // A CRM pipeline: its module isn't open, so the file offers to open it, and waits.
  await upload(page, id, await book("Pipeline.xlsx", { Pipeline: [
    ["Opportunity", "Customer", "Stage", "Salesperson", "Expected Revenue", "Probability", "Expected Closing"],
    ["Ventilators", "Cairo Hospital", "Proposition", "Sam", 500000, 60, "30/11/2026"],
    ["Monitors", "Alex Clinic", "Qualified", "Lee", 90000, 20, "15/12/2026"],
  ] }));
  await expect(page.getByTestId("module-offer")).toContainText("CRM");
  await expect(page.getByTestId("intake-next")).toBeDisabled();
  await page.getByTestId("module-offer-open").click();
  await expect(page.getByTestId("module-offer")).toHaveCount(0, { timeout: 20_000 });
  await saveAll(page);
  await expect(page.locator("header").getByTestId("tab-mod_crm")).toHaveText("CRM (opportunities)");
  expect(sql(`select string_agg(key || ':' || enabled, ',' order by key) from public.company_modules where company_id = '${id}' and kind = 'catalog'`)).toBe("crm:true,hr:true,purchasing:false");

  // A table no module knows: built into a module of its own, then saved into it.
  await upload(page, id, await book("Visits.xlsx", { Visits: [
    ["Visit Date", "Clinic", "Doctor", "Patient Ref", "Fee"],
    ["01/10/2026", "North", "Dr A", "P-001", 300],
    ["02/10/2026", "South", "Dr B", "P-002", 250],
  ] }));
  const visits = page.getByTestId("intake-piece").first();
  await expect(visits).toHaveAttribute("data-module", "");
  await visits.getByTestId("module-build").click();
  await visits.getByTestId("module-build-name").fill("Clinic visits");
  await visits.getByTestId("module-build-create").click();
  await expect(visits).toHaveAttribute("data-module", "c_clinic_visits", { timeout: 20_000 });
  await saveAll(page);
  await page.goto(`/company/${id}/modules/c_clinic_visits`);
  await expect(page.getByTestId("module-total")).toContainText("550");

  // A viewer: sees CRM, never HR (the page says so, and the database returns no HR rows).
  const viewer = newEmail("modv");
  await signOut(page);
  await signUp(page, { name: "Mods Viewer", org: "Viewer Home", email: viewer });
  const org = sql(`select org_id from public.companies where id = '${id}'`);
  sql(`insert into public.memberships (org_id, user_id, role) select '${org}', id, 'viewer' from auth.users where email = '${viewer}'`);
  await page.goto(`/company/${id}/modules/hr`);
  await expect(page.getByTestId("module-denied")).toBeVisible();
  await page.goto(`/company/${id}/modules/crm`);
  await expect(page.getByTestId("module-page")).toBeVisible();
  await expect(page.locator("header").getByTestId("tab-mod_crm")).toHaveAttribute("aria-current", "page");
  await expect(page.locator("header").getByTestId("tab-mod_hr")).toHaveCount(0);

  // The owner gives HR to the viewer by name; now it opens.
  await signOut(page);
  await signIn(page, owner, PASSWORD);
  await expect(page).toHaveURL(/\/companies/);
  await page.goto(`/company/${id}/settings/modules`);
  await page.getByTestId("mod-access-hr").click();
  const uid = sql(`select id from auth.users where email = '${viewer}'`);
  await page.getByLabel("Named people").selectOption(uid);
  await page.getByTestId("mod-access-save-hr").click();
  await expect.poll(() => sql(`select members::text from public.company_modules where company_id = '${id}' and key = 'hr'`)).toContain(uid);
  await signOut(page);
  await signIn(page, viewer, PASSWORD);
  await expect(page).toHaveURL(/\/companies/);
  await page.goto(`/company/${id}/modules/hr`);
  await expect(page.getByTestId("module-rows")).toContainText("3");
});

test("a company with only sales data uses every sales page and its own month picker", async ({ page }) => {
  await signUp(page, { name: "Sales Only", org: "Sales Only Org", email: newEmail("sonly") });
  await page.goto("/companies");
  await page.getByTestId("add-company").click();
  await page.getByTestId("tile-odoo").click();
  await page.getByTestId("odoo-files").click();
  await page.getByLabel("Company name").fill("Sales Only Co");
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(/\/company\/[0-9a-f-]{36}\/data/);
  const id = page.url().match(/\/company\/([0-9a-f-]{36})/)![1];
  await upload(page, id, await book("Sales.xlsx", { Sales: [
    ["Date", "Invoice", "Customer", "Product", "Quantity", "Untaxed Amount"],
    ["05/09/2026", "INV/2026/0101", "Nile Hospital", "Ventilator", 1, 12000],
    ["20/10/2026", "INV/2026/0144", "Delta Clinic", "Mask", 100, 5000],
  ] }));
  await saveAll(page);
  // The home shows Sales on its own; Sales pages pick their own months, with no "upload the books first".
  await page.goto(`/company/${id}`);
  await expect(page.getByTestId("home-card-sales")).toBeVisible();
  for (const p of ["sales", "sales/products", "sales/customers", "sales/trend"]) {
    await page.goto(`/company/${id}/${p}`);
    await expect(page.getByTestId("period-picker")).toBeVisible();
    await expect(page.getByTestId("no-data")).toHaveCount(0);
  }
  await page.goto(`/company/${id}/sales?type=month&end=2026-09`);
  await expect(page.getByTestId("period-end")).toContainText("Sep");
  // Checked against the books: not checked yet, never red.
  await page.goto(`/company/${id}/sales?type=month&end=2026-10`);
  await expect(page.getByTestId("agree-sales_revenue")).toHaveAttribute("data-status", "not_checked");
});

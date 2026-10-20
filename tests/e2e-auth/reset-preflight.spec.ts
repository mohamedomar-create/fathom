import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { createCompany, fixture, newEmail, requireLocalStack, signUp, startUpload } from "./helpers";

requireLocalStack();
const sql = (q: string) => execFileSync("psql", [process.env.DB_URL ?? "postgres://postgres:postgres@127.0.0.1:54322/postgres", "-tAq", "-c", q]).toString().trim();

// A sales export as people really send it: a title above the headings, a blank row, a line exported twice, a line with
// no amount and a total row at the bottom.
const messy = [
  "Invoice analysis – September 2026,,,",
  ",,,",
  "Date,Number,Customer,Untaxed Amount",
  "2026-09-01,INV/2026/0001,Alpha Clinic,1000",
  "2026-09-02,INV/2026/0002,Beta Hospital,500",
  ",,,",
  "2026-09-02,INV/2026/0002,Beta Hospital,500",
  "2026-09-03,INV/2026/0003,Gamma Center,",
  "Total,,,2000",
].join("\n");

test("a messy sales file: assessed, fixed with the person's decisions, previewed, confirmed and saved; rejected rows listed", async ({ page }) => {
  await signUp(page, { name: "Preflight Owner", org: "Preflight Advisory", email: newEmail("pf") });
  const id = await createCompany(page, "Preflight Co");
  await startUpload(page, id, "sales");
  await page.getByTestId("file-input").setInputFiles({ name: "sales-sep.csv", mimeType: "text/csv", buffer: Buffer.from(messy, "utf8") });

  const sheet = page.getByTestId("preflight-sheet");
  await expect(sheet).toHaveAttribute("data-status", "ready_after_fixes", { timeout: 15_000 });
  await expect(sheet).toContainText("headings on row 3");
  await expect(sheet.locator('[data-code="duplicates"]')).toContainText("rows 5, 7");
  await expect(sheet.locator('[data-code="missing_values"]')).toContainText("row 8");
  await expect(page.getByTestId("preflight-continue")).toBeDisabled();

  await page.getByTestId("preflight-dups-keep_first").check();
  await page.getByTestId("preflight-drop-missing").check();
  await expect(page.getByTestId("preflight-passes")).toBeVisible();
  await page.getByTestId("preflight-preview").click();
  await expect(page.getByTestId("preflight-before-after")).toContainText("Cleaned copy");
  await expect(page.getByTestId("preflight-rejected")).toContainText("2 rows will not be imported");
  const download = page.waitForEvent("download");
  await page.getByTestId("preflight-download-csv").click();
  expect((await download).suggestedFilename()).toMatch(/cleaned\.csv$/);

  await page.getByTestId("preflight-continue").click();
  await expect(page.getByTestId("sales-preview")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("sales-total")).toContainText("1,500");
  await page.getByTestId("sales-next").click();
  await expect(page.getByTestId("preflight-summary")).toContainText("Preflight Co");
  await expect(page.getByTestId("preflight-summary-rows")).toContainText("2 to import · 2 skipped");
  await page.getByTestId("save-sales").click();
  await expect(page.getByTestId("done-step")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("done-rejected")).toContainText("2 rows were not imported");
  expect(sql(`select count(*) || ' ' || sum(amount) from public.sales_lines where company_id = '${id}'`)).toBe("2 1500.00");
});

test("a sales file without an amount column cannot be imported until a column is chosen", async ({ page }) => {
  await signUp(page, { name: "Map Owner", org: "Map Advisory", email: newEmail("pfm") });
  const id = await createCompany(page, "Map Co");
  await startUpload(page, id, "sales");
  const csv = "Date,Number,Customer,Net EGP\n2026-09-01,INV/1,Alpha,100\n2026-09-02,INV/2,Beta,50";
  await page.getByTestId("file-input").setInputFiles({ name: "no-amount.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
  await expect(page.getByTestId("preflight-sheet")).toHaveAttribute("data-status", "cannot_import", { timeout: 15_000 });
  await expect(page.getByTestId("preflight-sheet").locator('[data-code="missing_column"]')).toContainText("Untaxed amount or Total");
  await expect(page.getByTestId("preflight-continue")).toBeDisabled();
  await page.getByTestId("preflight-map-untaxed").selectOption({ label: "D: Net EGP" });
  await expect(page.getByTestId("preflight-continue")).toBeEnabled();
  await page.getByTestId("preflight-continue").click();
  await expect(page.getByTestId("sales-total")).toContainText("150", { timeout: 15_000 });
});

test("clearing one module shows what goes, then leaves the company ready; deleting needs the name and leaves a record", async ({ page }) => {
  await signUp(page, { name: "Reset Owner", org: "Reset Advisory", email: newEmail("rs") });
  const id = await createCompany(page, "Reset Co");
  await startUpload(page, id, "sales");
  await page.getByTestId("file-input").setInputFiles(fixture("odoo-invoice-analysis.xlsx"));
  await page.getByTestId("sales-next").click({ timeout: 15_000 });
  await page.getByTestId("save-sales").click();
  await expect(page.getByTestId("done-step")).toBeVisible({ timeout: 30_000 });
  const lines = sql(`select count(*) from public.sales_lines where company_id = '${id}'`);
  expect(Number(lines)).toBeGreaterThan(0);

  await page.goto(`/company/${id}/settings/profile`);
  const zone = page.getByTestId("data-and-deletion");
  await expect(zone).toContainText(`${Number(lines).toLocaleString("en-US")} records`);
  await zone.getByRole("button", { name: "Clear" }).first().click();
  const dialog = page.getByTestId("clear-sales-dialog");
  await expect(dialog.getByTestId("reset-tables-sales")).toContainText(`${Number(lines).toLocaleString("en-US")} sales lines`);
  await expect(dialog).toContainText("odoo-invoice-analysis.xlsx");
  await dialog.getByTestId("confirm-button").click();
  await expect(page.getByRole("status")).toContainText("ready for a clean upload");
  expect(sql(`select count(*) from public.sales_lines where company_id = '${id}'`)).toBe("0");
  expect(sql(`select action || ':' || scope from public.company_data_audit where company_id = '${id}'`)).toBe("clear_module:sales");

  await page.getByRole("button", { name: "Delete this company" }).click();
  const del = page.getByTestId("delete-company-dialog");
  await expect(del.getByTestId("confirm-button")).toBeDisabled();
  await del.getByTestId("confirm-input").fill("Reset Co");
  await del.getByTestId("confirm-button").click();
  await page.waitForURL(/\/companies/);
  expect(sql(`select count(*) from public.companies where id = '${id}'`)).toBe("0");
  expect(sql(`select string_agg(action, ',' order by id) from public.company_data_audit where company_id = '${id}'`)).toBe("clear_module,delete_company");
});

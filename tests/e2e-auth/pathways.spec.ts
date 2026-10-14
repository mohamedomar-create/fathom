import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { createCompany, fixture, importFiles, newEmail, requireLocalStack, signUp } from "./helpers";

requireLocalStack();

/** The settings a company admin uses, each saved and checked to have taken effect. */
test("company settings, mapping, organisation and report download all work", async ({ page }) => {
  test.setTimeout(240_000);
  await signUp(page, { name: "Path Owner", org: "Path Advisory", email: newEmail("path") });
  const id = await createCompany(page, "Path Co");
  await importFiles(page, id, ["odoo-pl-bs.xlsx"]);

  // Profile: the new name shows across the company.
  await page.goto(`/company/${id}/settings/profile`);
  await page.getByLabel("Company name").fill("Path Co Renamed");
  await page.getByLabel("Industry").fill("Medical supplies");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.goto(`/company/${id}/summary`);
  await expect(page.getByText("Path Co Renamed").first()).toBeVisible();

  // Mapping: moving an account changes the analysis.
  await page.goto(`/company/${id}/analysis/profitability`);
  const gpBefore = await page.getByTestId("tile-gp").innerText();
  await page.goto(`/company/${id}/settings/chart-of-accounts`);
  const select = page.locator('select[aria-label^="Reclassify"]').first();
  const original = await select.inputValue();
  await select.selectOption("other_income");
  await page.getByRole("button", { name: "Save mapping" }).click();
  await expect(page.getByText(/1 account\(s\) reclassified/)).toBeVisible();
  await page.goto(`/company/${id}/analysis/profitability`);
  if (original !== "other_income") await expect(page.getByTestId("tile-gp")).not.toHaveText(gpBefore);

  // Alerts: a switch saves.
  await page.goto(`/company/${id}/settings/alerts`);
  await page.getByRole("switch").first().click();
  await page.getByTestId("save-kpis").click();
  await expect(page.getByText(/Saved\./)).toBeVisible();

  // Organisation details.
  await page.goto("/admin/organisation");
  await page.getByLabel("Organisation name").fill("Path Advisory Group");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  // A report downloads as a real PDF.
  await page.goto(`/company/${id}/reports`);
  await page.getByTestId("create-report").click();
  await expect(page).toHaveURL(/\/reports\/[0-9a-f-]{36}$/);
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), page.getByTestId("download-pdf").click()]);
  const path = await download.path();
  const fs = await import("node:fs");
  expect(fs.readFileSync(path!).subarray(0, 5).toString()).toBe("%PDF-");

  // Deleting the company asks for its name, then it is gone.
  await page.goto(`/company/${id}/settings/profile`);
  await page.getByRole("button", { name: "Delete this company" }).click();
  const dialog = page.getByTestId("delete-company-dialog");
  await dialog.getByRole("textbox").fill("Path Co Renamed");
  await dialog.getByRole("button", { name: "Delete company" }).click();
  await expect(page).toHaveURL(/\/companies/);
  await expect(page.getByText("Path Co Renamed")).toHaveCount(0);
  expect((await page.goto(`/company/${id}/summary`))?.status()).toBe(404);
});

/** Odoo's General Ledger, Trial Balance and P&L for the same dates import in one go, with nothing blocking. */
test("an Odoo ledger with an unexplained opening adjustment imports cleanly and balances", async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, { name: "Ledger Owner", org: "Ledger Advisory", email: newEmail("ledger") });
  const id = await createCompany(page, "Ledger Co");
  await page.goto(`/company/${id}/settings/source-data`);
  await page.waitForLoadState("networkidle");
  await expect(async () => {
    await page.getByTestId("file-input").setInputFiles(["general-ledger", "trial-balance", "profit-and-loss"].map((n) => fixture(`egypt-odoo-${n}.xlsx`)));
    await expect(page.getByTestId("review")).toBeVisible({ timeout: 4000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByTestId("review")).toContainText("Balances");
  await page.getByTestId("continue-timeline").click();
  await expect(page.getByTestId("timeline-step")).toBeVisible();
  await expect(page.locator('[data-testid="check-list"] [data-severity="block"]')).toHaveCount(0);
  await expect(page.getByTestId("accept-box")).toHaveCount(0);
  await page.getByTestId("commit-import").click();
  await expect(page).toHaveURL(/data-health\?imported=1/, { timeout: 30_000 });
  await page.goto(`/company/${id}/analysis/financials`);
  await page.getByTestId("period-picker").waitFor();
  // The ledger's revenue lines became sales, and they agree with the P&L.
  await page.getByTestId("tab-sales").click();
  await expect(page).toHaveURL(new RegExp(`/company/${id}/sales`));
  await expect(page.getByTestId("sales-headline")).toBeVisible();
  await expect(page.getByTestId("sales-reconciled")).toBeVisible();
  await page.goto(`/company/${id}/settings/chart-of-accounts`);
  await page.getByRole("button", { name: "Balance Sheet" }).click();
  await expect(page.locator('select[aria-label="Reclassify z Adjustment"]')).toHaveValue("other_equity");
});

/** A sales export on its own: read, previewed with its columns, saved to the Sales sector without touching the financial figures. */
test("an Odoo Invoice Analysis export becomes sales by customer and product", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, { name: "Sales Owner", org: "Sales Advisory", email: newEmail("sales") });
  const id = await createCompany(page, "Sales Co");
  await page.goto(`/company/${id}/settings/source-data`);
  await page.waitForLoadState("networkidle");
  await expect(async () => {
    await page.getByTestId("file-input").setInputFiles(fixture("odoo-invoice-analysis.xlsx"));
    await expect(page.getByTestId("sales-preview")).toBeVisible({ timeout: 4000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByTestId("sales-total")).toContainText("197,800");
  await expect(page.getByTestId("tax-warning")).toHaveCount(0);
  await page.getByTestId("save-sales").click();
  await expect(page).toHaveURL(new RegExp(`/company/${id}/sales`), { timeout: 30_000 });
  await expect(page.getByTestId("tile-sales")).toContainText("93,800");
  await page.goto(`/company/${id}/sales/products?type=year&end=2026-02`);
  await expect(page.getByTestId("product-table")).toContainText("CPAP Machine");
  await expect(page.getByTestId("product-table")).toContainText("Margin");
});

/** A scanned PDF of audited statements: pages read (by a stand-in for the reader), totals checked, a misread figure corrected, then imported. */
test("PDF statements are read, checked, corrected and imported", async ({ page }) => {
  test.setTimeout(180_000);
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // Page heights tell the stand-in reader which page it was sent.
  for (const [h, title] of [[800, "Income statement"], [801, "Statement of financial position"]] as const) doc.addPage([600, h]).drawText(title, { x: 40, y: h - 60, size: 18, font });
  const pdf = Buffer.from(await doc.save());

  const r = (label: string, values: number[], o: Record<string, boolean> = {}) => ({ code: "", label, values, total: false, heading: false, unclear: false, ...o });
  const t = (label: string, values: number[]) => r(label, values, { total: true });
  const base = { company: "Delta Trading S.A.E.", currency: "EGP", scale: "units", columns: ["2025", "2024"] };
  const pl = (revenue: number) => ({ ...base, kind: "pl", title: "Income statement", dateText: "For the year ended 31 December 2025", rows: [
    r("Revenue", [revenue, 9500000]), r("Cost of sales", [-8000000, -6500000]), t("Gross profit", [4000000, 3000000]),
    r("General and administrative expenses", [-2750000, -2250000]), t("Profit before tax", [1250000, 750000]), r("Income tax", [-281250, -168750]), t("Net profit for the year", [968750, 581250]),
  ] });
  const bs = { ...base, kind: "bs", title: "Statement of financial position", dateText: "As at 31 December 2025", rows: [
    r("Property, plant and equipment", [2500000, 2300000]), r("Inventories", [1800000, 1400000]), r("Trade receivables", [3200000, 2200000]),
    r("Cash and cash equivalents", [60000, 800000]), t("Total assets", [8100000, 6700000]),
    r("Share capital", [2000000, 2000000], { unclear: true }), r("Retained earnings", [2068750, 1100000]), t("Total equity", [4068750, 3100000]),
    r("Long-term loans", [1200000, 1000000]), r("Bank overdraft", [1100000, 900000]), r("Trade payables", [1450000, 1450000]), r("Income tax payable", [281250, 250000]),
    t("Total liabilities", [4031250, 3600000]), t("Total equity and liabilities", [8100000, 6700000]),
  ] };
  const asked: string[] = [];
  await page.route("**/read-page", async (route) => {
    const body = route.request().postDataBuffer()?.toString("latin1") ?? "";
    const second = body.includes('name="check"');
    asked.push(`${body.includes(" 801 ]") ? "bs" : "pl"}${second ? " again" : ""}`);
    // The P&L is misread the first time (revenue 1,200,000) and read right when asked to look again; the cash figure stays misread.
    const read = body.includes(" 801 ]") ? bs : pl(second ? 12000000 : 1200000);
    await route.fulfill({ json: { read } });
  });

  await signUp(page, { name: "Pdf Owner", org: "Pdf Advisory", email: newEmail("pdf") });
  const id = await createCompany(page, "Pdf Co");
  await page.goto(`/company/${id}/settings/source-data`);
  await page.waitForLoadState("networkidle");
  await expect(async () => {
    await page.getByTestId("file-input").setInputFiles({ name: "statements.pdf", mimeType: "application/pdf", buffer: pdf });
    await expect(page.getByTestId("pdf-review")).toBeVisible({ timeout: 8000 });
  }).toPass({ timeout: 60_000 });
  expect(asked.sort()).toEqual(["bs", "bs again", "pl", "pl again"]);

  // Left to check: total assets (cash misread) and the unclear share capital.
  await expect(page.getByTestId("pdf-flag-count")).toContainText("2 rows to check");
  await expect(page.getByTestId("pdf-page")).toHaveCount(2);
  await expect(page.getByRole("img", { name: "Page 1 of statements.pdf" })).toBeVisible({ timeout: 15_000 });
  const cash = page.getByLabel("Cash and cash equivalents 2025");
  await cash.fill("600000");
  await cash.blur();
  await page.getByRole("button", { name: "Figures are right" }).click();
  await expect(page.getByTestId("pdf-all-add-up")).toBeVisible();
  await page.getByTestId("pdf-use").click();

  await expect(page.getByTestId("review")).toBeVisible();
  await page.getByTestId("continue-timeline").click();
  await expect(page.getByTestId("timeline-step")).toBeVisible();
  if (await page.getByTestId("accept-box").isVisible()) {
    await page.getByTestId("accept-check").check();
    await page.getByTestId("accept-reason").fill("Annual audited statements read from PDF.");
  }
  await page.getByTestId("commit-import").click();
  await expect(page).toHaveURL(/data-health\?imported=1/, { timeout: 30_000 });
  // The year's revenue from the corrected reading, not the first misreading.
  await page.goto(`/company/${id}/analysis/financials?type=year&end=2025-12`);
  await expect(page.getByText(/12,000,000|12\.0M/).first()).toBeVisible();
});

/** iReport's own templates: downloaded, filled in, uploaded and read exactly; a template with mistakes is stopped with each one listed. */
test("filled templates import exactly, and mistakes are listed before anything is imported", async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, { name: "Tpl Owner", org: "Tpl Advisory", email: newEmail("tpl") });
  const id = await createCompany(page, "Tpl Co");
  const get = async (kind: string) => { const wb = new ExcelJS.Workbook(); const body = await (await page.request.get(`/api/templates/${kind}?fy=1&currency=EGP&year=2026`)).body(); await wb.xlsx.load(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer); return wb; };
  const rowOf = (ws: ExcelJS.Worksheet, name: string) => { let n = 0; ws.eachRow((r, i) => { if (r.getCell(2).value === name) n = i; }); return ws.getRow(n); };
  const fin = await get("financials");
  const pl = fin.getWorksheet("P&L")!, bs = fin.getWorksheet("Balance Sheet")!;
  for (const [n, a, b] of [["Sales revenue", 100000, 120000], ["Cost of goods sold", 60000, 70000], ["Salaries and wages", 20000, 20000], ["Rent", 5000, 5000], ["Income tax", 3000, 5000]] as const) { const r = rowOf(pl, n); r.getCell(4).value = a; r.getCell(5).value = b; }
  for (const [n, o, a, b] of [["Cash in hand and banks", 50000, 57000, 72000], ["Customers", 30000, 35000, 40000], ["Inventory", 20000, 20000, 25000], ["Suppliers", 25000, 25000, 30000], ["Share capital", 50000, 50000, 50000], ["Retained earnings incl. profit to date", 25000, 37000, 57000]] as const) { const r = rowOf(bs, n); r.getCell(4).value = o; r.getCell(5).value = a; r.getCell(6).value = b; }
  rowOf(pl, "Rent").getCell(5).value = "five thousand";
  const bad = Buffer.from(await fin.xlsx.writeBuffer());

  await page.goto(`/company/${id}/settings/source-data?step=financials`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("upload-step")).toContainText("monthly financials");
  // A mistake is shown on the sheet and named by row and column; nothing can be imported until it is fixed in the box.
  await expect(async () => {
    await page.getByTestId("file-input").setInputFiles({ name: "financials.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: bad });
    await expect(page.getByTestId("error-count")).toHaveText("1 error to fix", { timeout: 4000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByTestId("issue-list")).toContainText('row 11, column E: "five thousand" is not a number');
  await expect(page.getByTestId("raw-tab-P&L")).toContainText("1");
  await expect(page.getByTestId("continue-timeline")).toBeDisabled();
  await page.getByTestId("fix-input").fill("5000");
  await page.getByTestId("fix-apply").click();
  await expect(page.getByTestId("error-count")).toHaveText("0 errors: ready to import");
  await expect(page.getByTestId("review")).toContainText("Balances");
  await page.getByTestId("continue-timeline").click();
  await expect(page.getByTestId("timeline-step")).toBeVisible();
  await page.getByTestId("commit-import").click();
  await expect(page).toHaveURL(/data-health\?imported=1/, { timeout: 30_000 });
  await expect(page.getByTestId("import-readiness")).toBeVisible();
  // The correction is kept with the import.
  const fixes = page.getByTestId("history-fixes").first();
  await fixes.locator("summary").click();
  await expect(fixes).toContainText("P&L, row 11, column E set to 5,000 (was 'five thousand')");
  await expect(page.getByTestId("ready-item-financials-opening")).toHaveAttribute("data-status", "done");
  await page.goto(`/company/${id}/analysis/cashflow?type=month&end=2026-01`);
  await expect(page.getByTestId("tile-dcash")).toContainText("7,000");

  // Sales template: one row per invoice line, saved to the Sales sector.
  const sales = await get("sales");
  const ws = sales.getWorksheet("Sales")!;
  // The third line has no date: an error to fix (here, the row is left out) before the sales can be saved.
  [[new Date(Date.UTC(2026, 0, 15)), "INV/2026/0001", "Clinic A", "Concentrator", "Devices", "Sara", 2, 60000, 36000], [new Date(Date.UTC(2026, 0, 20)), "INV/2026/0002", "Clinic B", "Mask", "Consumables", "Omar", 100, 40000, 24000], [null, "INV/2026/0003", "Clinic C", "Mask", "Consumables", "Omar", 1, 999, 500]]
    .forEach((r, i) => r.forEach((v, j) => { ws.getRow(5 + i).getCell(j + 1).value = v; }));
  await page.goto(`/company/${id}/settings/source-data?step=sales`);
  await page.waitForLoadState("networkidle");
  await expect(async () => {
    await page.getByTestId("file-input").setInputFiles({ name: "sales.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await sales.xlsx.writeBuffer()) });
    await expect(page.getByTestId("sales-preview")).toBeVisible({ timeout: 4000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByTestId("error-count")).toHaveText("1 error to fix");
  await expect(page.getByTestId("issue-list")).toContainText("row 7, column A: no invoice date on this line");
  await expect(page.getByTestId("save-sales")).toBeDisabled();
  await page.getByTestId("fix-skip").click();
  await expect(page.getByTestId("error-count")).toHaveText("0 errors: ready to import");
  await expect(page.getByTestId("sorted-sales-total")).toContainText("100,000");
  await page.getByTestId("save-sales").click();
  await expect(page).toHaveURL(new RegExp(`/company/${id}/sales`), { timeout: 30_000 });
  await page.goto(`/company/${id}/settings/data-setup`);
  await expect(page.getByTestId("ready-item-sales-reconciled")).toHaveAttribute("data-status", "done");
});

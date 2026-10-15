import { expect, test } from "@playwright/test";
import { createCompany, importFiles, newEmail, requireLocalStack, signIn, signOut, signUp, startUpload, PASSWORD } from "./helpers";
import { stockFiles } from "../fixtures/stock-workbook";

requireLocalStack();

test("a new user signs up, imports Odoo data and works with their own numbers", async ({ page, browser }) => {
  test.slow();
  const email = newEmail("owner");
  await signUp(page, { name: "Nadia Owner", org: "Nile Advisory", email });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const id = await createCompany(page, "Nile Medical");
  await importFiles(page, id, ["odoo-pl-bs.xlsx"]);

  // Analysis on the imported data.
  await page.goto(`/company/${id}/summary`);
  await expect(page.getByTestId("headline")).toContainText("EGP 1,066,138");
  await page.goto(`/company/${id}/analysis/financials`);
  await expect(page.locator("h1")).toHaveText("Financials");

  // Bank assumptions are saved to the company and come back after a reload.
  await page.goto(`/company/${id}/banking`);
  await page.getByTestId("assume-rate").fill("22");
  await page.getByTestId("assume-requestAmount").fill("1000000");
  await page.getByTestId("assume-requestType").selectOption("working_capital");
  await page.getByTestId("save-assumptions").click();
  await expect(page.getByText("Saved for this company.")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("assume-rate")).toHaveValue("22");
  await expect(page.getByTestId("tile-request")).toContainText("EGP 1.0M");

  // Saving KPI targets keeps the assumptions (they share a column).
  await page.goto(`/company/${id}/settings/targets`);
  const target = page.locator('input[type="number"]').first();
  await target.fill("123");
  await page.getByTestId("save-kpis").click();
  await expect(page.getByText(/Saved\. KPIs/)).toBeVisible();
  await page.goto(`/company/${id}/analysis/real-profit`);
  await expect(page.getByTestId("assume-rate")).toHaveValue("22");

  // Forecast drivers are saved to the company and survive a KPI save.
  await page.goto(`/company/${id}/analysis/forecast`);
  await page.getByTestId("fc-dso").fill("30");
  await page.getByTestId("fc-capex").fill("15000");
  await page.getByTestId("save-forecast").click();
  await expect(page.getByText("Saved for this company.")).toBeVisible();
  await page.goto(`/company/${id}/settings/targets`);
  await page.locator('input[type="number"]').first().fill("124");
  await page.getByTestId("save-kpis").click();
  await expect(page.getByText(/Saved\. KPIs/)).toBeVisible();
  await page.goto(`/company/${id}/analysis/forecast`);
  await expect(page.getByTestId("fc-dso")).toHaveValue("30");
  await expect(page.getByTestId("fc-capex")).toHaveValue("15000");
  await page.goto(`/company/${id}/analysis/real-profit`);
  await expect(page.getByTestId("assume-rate")).toHaveValue("22");

  // Full data export.
  const xlsx = await page.request.get(`/api/export/${id}`);
  expect(xlsx.status()).toBe(200);
  expect(xlsx.headers()["content-type"]).toContain("spreadsheetml");

  // A report with the bank page, published to a link that works signed out, then withdrawn.
  await page.goto(`/company/${id}/reports`);
  await page.getByTestId("create-report").click();
  await expect(page).toHaveURL(/\/reports\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Show Bank Readiness", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Report saved.")).toBeVisible();
  await page.getByRole("button", { name: "Publish report" }).click();
  const link = page.locator('input[readonly][value*="/r/"]');
  await expect(link).toBeVisible();
  const url = await link.inputValue();
  const anon = await browser.newContext();
  const visitor = await anon.newPage();
  await visitor.goto(url);
  await expect(visitor.locator('[data-section="bank"]')).toContainText("Debt service cover");
  await expect(visitor.locator('[data-section="summary"]')).toContainText("EGP 1,066,138");
  await page.getByRole("button", { name: "Stop sharing" }).click();
  await expect(page.getByRole("button", { name: "Publish report" })).toBeVisible();
  const gone = await visitor.goto(url);
  expect(gone?.status()).toBe(404);
  await anon.close();

  // Sign out, then back in.
  await signOut(page);
  await page.goto(`/company/${id}/summary`);
  await expect(page).toHaveURL(/\/login\?next=/);
  await signIn(page, email, "wrong-password-1");
  await expect(page.getByRole("status")).toContainText("The email or password is not right.");
  await signIn(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/companies/);
  await expect(page.getByText("Nile Medical")).toBeVisible();
});

test("Arabic: a signed-in user's companies, account and menu read in Arabic", async ({ page }) => {
  const email = newEmail("arabic");
  await signUp(page, { name: "Salma Ar", org: "Delta Advisory", email });
  await page.goto("/companies");
  await page.getByTestId("user-menu").click();
  await page.getByTestId("lang-switch").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("عدد الشركات: 0");
  await expect(page.getByTestId("add-company")).toContainText("إضافة شركة");
  await page.goto("/account");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("حسابك");
  await expect(page.getByTestId("delete-account")).toHaveText("حذف حسابي");
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("لوحة المؤشرات");
});

test("stock imports run as background jobs: sample first, then checked and saved once, with problems shown by row", async ({ page }) => {
  test.slow();
  await signUp(page, { name: "Stock Owner", org: "Stock Advisory", email: newEmail("stock") });
  const id = await createCompany(page, "Stock Co");
  const job = () => page.getByTestId("import-job").first();
  const run = async (mode: "replace" | "add" | "all" | "update", files: Awaited<ReturnType<typeof stockFiles>>) => {
    await startUpload(page, id, "inventory", "inventory");
    await page.getByTestId("file-input").setInputFiles(files);
    // A sample of each file, before the whole file is read: which export it is, its columns, its first rows.
    await expect(page.getByTestId("import-sample")).toHaveCount(2, { timeout: 15_000 });
    await expect(page.getByTestId("import-preview").first()).toContainText("[P1] Mask");
    await page.getByTestId("import-next").click();
    await page.getByTestId(`import-mode-${mode}`).click();
    await page.getByTestId("import-start").click();
    await expect(page.getByTestId("import-running")).toBeVisible();
    return job();
  };
  // 3 valuation layers and 4 moves, saved by the background worker.
  let j = await run("replace", await stockFiles());
  await expect(j).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  await expect(j.getByTestId("import-job-counts")).toContainText("7 added · 0 changed · 0 already saved");
  // The same files again, adding only new records: every record is already here.
  j = await run("add", await stockFiles());
  await expect(j).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  await expect(j.getByTestId("import-job-counts")).toContainText("0 added · 0 changed · 7 already saved");
  // Changed in Odoo (later "Last updated on"): only that record is replaced.
  j = await run("update", await stockFiles({ value3: 120, updated3: "2026-10-01 09:00:00" }));
  await expect(j).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  await expect(j.getByTestId("import-job-counts")).toContainText("0 added · 1 changed · 6 already saved");
  // A row that cannot be read stops the job before anything is saved; the person sees it by row and chooses.
  j = await run("add", await stockFiles({ value3: 120, updated3: "2026-10-01 09:00:00", badRow: true }));
  await expect(j).toHaveAttribute("data-status", "needs_review", { timeout: 30_000 });
  await j.getByTestId("import-show-errors").click();
  await expect(j.getByTestId("import-errors")).toContainText('Quantity is not a number: "five"');
  await expect(j.getByTestId("import-errors")).toContainText("5");
  await j.getByTestId("import-accept").click();
  await expect(j).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  await expect(j.getByTestId("import-job-counts")).toContainText("1 row left out");

  // Stored once: closing value 1,000 − 400 + 120, and 15 units received.
  await page.goto(`/company/${id}/inventory/valuation`);
  await expect(page.getByTestId("inv-layers")).toContainText("EGP 720");
  await page.goto(`/company/${id}/inventory/movements`);
  await expect(page.getByTestId("inv-movements")).toContainText("15");
  await page.goto(`/company/${id}/inventory/products`);
  await expect(page.getByTestId("inv-products")).toContainText("[P1]");
  // Data health lists the imports.
  await page.goto(`/company/${id}/settings/data-health`);
  await expect(page.getByTestId("import-job")).toHaveCount(4);
});

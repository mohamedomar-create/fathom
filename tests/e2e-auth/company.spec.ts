import { expect, test } from "@playwright/test";
import { createCompany, importFiles, newEmail, requireLocalStack, signIn, signOut, signUp, PASSWORD } from "./helpers";

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
  await page.goto(`/company/${id}/analysis/bank`);
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
  await expect(page.getByRole("status")).toContainText(/invalid/i);
  await signIn(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/companies/);
  await expect(page.getByText("Nile Medical")).toBeVisible();
});

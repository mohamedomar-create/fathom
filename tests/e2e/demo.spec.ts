import { expect, test } from "@playwright/test";
import path from "node:path";
import { STOCK_FILE, stockWorkbook } from "../fixtures/stock-workbook";

const PAGES = ["summary", "analysis/kpis", "analysis/explorer", "analysis/profitability", "analysis/cashflow", "analysis/growth", "analysis/trend", "analysis/goalseek", "analysis/forecast", "analysis/financials", "banking", "analysis/real-profit", "sales", "sales/products", "sales/customers", "sales/trend"];

test("landing page leads to the demo", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("cta-demo").click();
  await expect(page).toHaveURL(/\/demo\/summary/);
  await expect(page.getByTestId("headline")).toContainText("EGP 1,066,138");
});

for (const p of PAGES) {
  test(`demo ${p} renders without errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`/demo/${p}`);
    await expect(page.locator("h1")).toBeVisible();
    await page.waitForTimeout(400);
    expect(errors).toEqual([]);
  });
}

test("period picker switches to a quarter and the numbers change", async ({ page }) => {
  await page.goto("/demo/analysis/profitability");
  const before = await page.getByTestId("tile-gp").innerText();
  await page.getByTestId("period-type").click();
  await page.getByRole("button", { name: "Quarter", exact: true }).click();
  await expect(page).toHaveURL(/type=quarter/);
  await expect(page.getByTestId("tile-gp")).not.toHaveText(before);
  await expect(page.getByTestId("period-picker")).toContainText("Q3 2026");
});

test("KPI detail modal opens with explanation and chart", async ({ page }) => {
  await page.goto("/demo/analysis/kpis");
  await page.getByTestId("kpi-gpm").click();
  await expect(page.getByRole("dialog")).toContainText("For each EGP100 in sales");
  await expect(page.getByRole("dialog").locator("svg").first()).toBeVisible();
});

test("goalseek lever changes move the NOW marker", async ({ page }) => {
  await page.goto("/demo/analysis/goalseek");
  const marker = page.getByTestId("now-marker");
  const before = await marker.innerText();
  await page.getByLabel("Price change %").fill("3");
  await expect(marker).not.toHaveText(before);
});

/** The upload, step by step: what → get file → upload. */
async function toUpload(page: import("@playwright/test").Page, kind: "accounts" | "sales" | "expenses" = "accounts") {
  await page.goto("/demo/data/upload");
  await expect(page.getByTestId("wiz-steps")).toHaveAttribute("data-at", "what");
  await page.getByTestId(`pick-${kind}`).click();
  await expect(page.getByTestId("get-odoo")).toContainText(kind === "sales" ? "Invoice Analysis" : kind === "expenses" ? "Vendor Bills" : "General Ledger");
  await page.getByTestId("wiz-next").click();
  await expect(page.getByTestId("dropzone")).toBeVisible();
}

test("Odoo export importer maps and balances a real file", async ({ page }) => {
  await toUpload(page);
  await page.getByTestId("file-input").setInputFiles(path.join(__dirname, "../fixtures/files/odoo-pl-bs.xlsx"));
  await expect(page.getByTestId("wiz-steps")).toHaveAttribute("data-at", "check");
  await expect(page.getByTestId("balanced")).toContainText("Yes");
  await expect(page.getByTestId("problems")).toContainText("0");
  await expect(page.getByTestId("error-count")).toHaveText("All good");
  await page.getByTestId("reading-tab-pl").click();
  await expect(page.getByTestId("sorted-pl")).toContainText("EGP 1,066,138");
  await expect(page.getByTestId("file-reading")).toContainText("Profit and Loss: 28 lines");
  // The demo saves nothing: the last step asks for an account.
  await expect(page.getByTestId("commit-import")).toHaveText(/Create a free account to save/);
});

test("an Odoo ledger, trial balance and P&L uploaded together: the ledger is imported, the others prove it", async ({ page }) => {
  const f = (n: string) => path.join(__dirname, `../fixtures/files/egypt-odoo-${n}.xlsx`);
  await toUpload(page);
  await page.getByTestId("file-input").setInputFiles([f("general-ledger"), f("trial-balance"), f("profit-and-loss")]);
  const reading = page.getByTestId("file-reading");
  await expect(reading).toContainText("Odoo General Ledger");
  await expect(page.getByTestId("check-only")).toHaveCount(2);
  await expect(page.getByTestId("date-order").first()).toContainText("month first");
  // The cut-off is the last day anything is posted (7 Oct), never the report's end, the export day or today.
  await expect(page.getByTestId("cutoff").locator("input")).toHaveValue("2026-10-07");
  await expect(page.getByTestId("review")).toContainText(/Trial Balance' covers several months in one total, so it was used to check the import instead of being imported: all \d+ account figures agree/);
  // Small unclassified lines are listed under "Left out", where a class can still be given.
  await page.getByTestId("reading-tab-out").click();
  await expect(page.getByTestId("left-out")).toContainText("z Adjustment");
  await expect(page.getByTestId("left-out")).toContainText("used to check the figures of the other file");
});

/** The two boxes: the file as uploaded beside iReport's sorted reading, linked both ways. */
test("each line of iReport's reading points to its rows in the file, and each row says what it became", async ({ page }) => {
  await toUpload(page);
  await page.getByTestId("file-input").setInputFiles(path.join(__dirname, "../fixtures/files/odoo-pl-bs.xlsx"));
  await expect(page.getByTestId("two-box")).toBeVisible();
  await expect(page.getByTestId("error-count")).toHaveText("All good");
  const phone = (page.viewportSize()?.width ?? 1440) < 1024;
  await page.getByTestId("reading-tab-pl").click();
  await expect(page.getByTestId("total-net")).toBeVisible();
  await page.getByTestId("sorted-pl").getByTestId("sorted-row").first().dispatchEvent("click");
  // On a phone the file tab opens at the line's rows.
  await expect(page.locator('[data-testid^="raw-row-"][data-focus="true"]').first()).toBeVisible();
  // A row on the left: what it became.
  await page.locator('[data-testid^="raw-row-"][data-role="header"]').first().dispatchEvent("click");
  if (phone) await page.getByTestId("tab-reading").click();
  await expect(page.getByTestId("picked-note")).toContainText("headings");
});

test("problems are fixed one at a time in the box; Next stays off until they are all fixed", async ({ page }) => {
  await toUpload(page);
  const csv = "Account,Jan 2026,Feb 2026,Mar 2026\nSales,1000,1200,1100\nCost of sales,600,seven hundred,650\nRent,100,n/a,100\n";
  await page.getByTestId("file-input").setInputFiles({ name: "messy-pl.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByTestId("error-count")).toHaveText("2 problems to fix");
  await expect(page.getByTestId("problem-counter")).toHaveText("Problem 1 of 2");
  const phone = (page.viewportSize()?.width ?? 1440) < 1024;
  if (phone) await page.getByTestId("tab-file").click();
  await expect(page.getByTestId("raw-error-2-2")).toHaveText("seven hundred");
  if (phone) {
    // Nothing spills sideways at phone width: each box scrolls inside itself.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.getByTestId("tab-reading").click();
  }
  await expect(page.getByTestId("issue-text")).toHaveText("Row 3, column C: must be a number.");
  await page.getByTestId("fix-input").fill("700");
  await page.getByTestId("fix-apply").click();
  await expect(page.getByTestId("problem-counter")).toHaveText("Problem 1 of 1");
  await expect(page.getByTestId("issue-text")).toHaveText("Row 4, column C: must be a number.");
  await page.getByTestId("fix-skip").click();
  await expect(page.getByTestId("error-count")).toHaveText("All good");
  await page.getByTestId("reading-tab-pl").click();
  await expect(page.getByTestId("sorted-pl")).toContainText("EGP 700");
});

test("the sorted reading downloads as iReport's template and reads back to the same figures", async ({ page }) => {
  await toUpload(page);
  await page.getByTestId("file-input").setInputFiles(path.join(__dirname, "../fixtures/files/odoo-pl-bs.xlsx"));
  await expect(page.getByTestId("error-count")).toHaveText("All good");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-sorted").click()]);
  expect(dl.suggestedFilename()).toBe("ireport-financials-filled.xlsx");
  const file = await dl.path();
  await page.getByRole("button", { name: "Choose another file" }).click();
  await page.getByTestId("file-input").setInputFiles(file);
  await expect(page.getByTestId("file-reading")).toContainText("iReport template");
  await expect(page.getByTestId("balanced")).toContainText("Yes");
  await expect(page.getByTestId("error-count")).toHaveText("All good");
  await page.getByTestId("reading-tab-pl").click();
  await expect(page.getByTestId("sorted-pl")).toContainText("EGP 1,066,138");
});

test("a sales file picked as accounts offers to switch", async ({ page }) => {
  await toUpload(page, "accounts");
  await page.getByTestId("file-input").setInputFiles(path.join(__dirname, "../fixtures/files/odoo-invoice-analysis.xlsx"));
  await expect(page.getByTestId("upload-notice")).toContainText("This looks like a sales file.");
  await page.getByTestId("switch-kind").click();
  await expect(page.getByTestId("upload-notice")).toHaveCount(0);
  await expect(page.getByTestId("sales-total")).toBeVisible();
});

test("a PDF in the demo says reading it needs an account", async ({ page }) => {
  await toUpload(page);
  await page.getByTestId("file-input").setInputFiles({ name: "statements.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n") });
  await expect(page.getByText(/Reading PDFs and scanned pages needs a free account/)).toBeVisible();
});

test("demo report downloads as a PDF", async ({ page }) => {
  test.slow();
  await page.goto("/demo/reports");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-pdf").click()]);
  expect(dl.suggestedFilename()).toMatch(/\.pdf$/);
});

test("app routes require sign-in", async ({ page }) => {
  await page.goto("/companies");
  await expect(page).toHaveURL(/\/login\?next=%2Fcompanies/);
  await expect(page.getByTestId("login-form")).toBeVisible();
});

test("data health shows loaded months, checks and sources", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/demo/data/checks");
  await expect(page.getByTestId("health-calendar")).toBeVisible();
  await expect(page.getByTestId("failed-count")).toContainText("0");
  const cell = page.locator('[data-status="ok"]').first();
  await cell.click();
  await expect(page.getByTestId("month-detail")).toContainText("Demo data");
  await page.getByTestId("trace-buttons").getByRole("button").first().click();
  await expect(page.getByTestId("source-drawer")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a financials figure opens the accounts behind it", async ({ page }) => {
  await page.goto("/demo/analysis/financials");
  await page.getByTestId("trace-gross_profit").click();
  const d = page.getByTestId("source-drawer");
  await expect(d).toContainText("Gross Profit");
  await expect(d).toContainText("Demo data");
  await expect(d).toContainText("(−)");
});

test("summary headline figures open their source accounts", async ({ page }) => {
  await page.goto("/demo/summary");
  await page.getByTestId("trace-cash").click();
  await expect(page.getByTestId("source-drawer")).toContainText("Cash on hand");
});

test("bank readiness reads the demo like a credit analyst and recomputes room to borrow", async ({ page }) => {
  await page.goto("/demo/banking");
  await expect(page.getByTestId("bank-basis")).toContainText("12 months to Sep 2026");
  await expect(page.getByTestId("tile-dscr")).toContainText("x");
  await expect(page.getByTestId("bank-ratios")).toContainText("Debt service cover");
  await expect(page.getByTestId("bank-checklist")).toContainText("Audited financial statements");
  const before = await page.getByTestId("tile-headroom").innerText();
  await page.getByTestId("assume-rate").fill("30");
  await expect(page.getByTestId("tile-headroom")).not.toHaveText(before);
  await page.getByTestId("ratio-dscr").locator("summary").click();
  await expect(page.getByTestId("ratio-dscr")).toContainText("What the bank sees");
});

test("real profit bridges reported to real profit and needs inflation for it", async ({ page }) => {
  await page.goto("/demo/analysis/real-profit");
  await expect(page.getByTestId("real-bridge")).toContainText("Real profit at today's prices");
  await expect(page.getByTestId("collection")).toContainText("Collection rate");
  await page.getByTestId("assume-inflation").fill("");
  await expect(page.getByTestId("tile-real")).toContainText("enter inflation");
  await expect(page.getByTestId("real-bridge")).toHaveCount(0);
});

test("bank readiness tests a loan request, stresses the year and writes the memo", async ({ page }) => {
  await page.goto("/demo/banking");
  await expect(page.getByTestId("bank-memo")).toContainText("Lead with");
  await expect(page.getByTestId("trend-table")).toContainText("Debt service cover");
  await expect(page.getByTestId("trend-note")).toContainText("Upload earlier audited statements");
  await expect(page.getByTestId("stress-table")).toContainText("Sales fall 20%");
  await expect(page.getByTestId("breaking-points")).toContainText("Sales can fall");
  await expect(page.getByTestId("tile-request")).toContainText("enter the amount");
  await page.getByTestId("assume-requestAmount").fill("3000000");
  await page.getByTestId("assume-requestType").selectOption("term_loan");
  await page.getByTestId("assume-requestPurpose").fill("a second warehouse");
  await expect(page.getByTestId("proforma")).toContainText("With the new facility");
  await expect(page.getByTestId("tile-request")).toContainText("EGP 3.0M");
  await expect(page.getByTestId("bank-memo")).toContainText("a second warehouse");
});

test("the report adds bank and real-profit pages and still downloads as a PDF", async ({ page }) => {
  test.slow();
  await page.goto("/demo/reports");
  for (const label of ["Bank Readiness", "Bank: trend & stress test", "Real Profit"]) await page.getByRole("button", { name: `Show ${label}`, exact: true }).click();
  await expect(page.locator('[data-section="bank"]')).toContainText("Debt service cover");
  await expect(page.locator('[data-section="bank_outlook"]')).toContainText("Stress test");
  await expect(page.locator('[data-section="realprofit"]')).toContainText("Real profit at today's prices");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-pdf").click()]);
  expect(dl.suggestedFilename()).toMatch(/\.pdf$/);
});

test("forecast projects profit, cash and the balance sheet, tested on the company's own months", async ({ page }) => {
  await page.goto("/demo/analysis/forecast");
  await expect(page.getByTestId("fc-basis")).toContainText("Oct 2026");
  await expect(page.getByTestId("tile-fc-revenue")).toContainText("EGP");
  await expect(page.getByTestId("fc-accuracy")).toContainText("We hid your last 3 months");
  await expect(page.getByTestId("fc-cash-verdict")).toContainText("Cash stays positive");
  const before = (await page.getByTestId("tile-fc-revenue").textContent())!;
  await page.getByTestId("fc-revenueGrowth").fill("40");
  await expect(page.getByTestId("tile-fc-revenue")).not.toHaveText(before);
  // A large dividend drains cash: the page says when it runs out and how much is needed.
  await page.getByTestId("fc-dividends").fill("50000000");
  await expect(page.getByTestId("fc-cash-verdict")).toContainText("Cash runs out in");
  await page.getByTestId("fc-reset").click();
  await expect(page.getByTestId("tile-fc-revenue")).toHaveText(before);
  await page.getByTestId("fc-tab-bs").click();
  await expect(page.getByTestId("fc-table")).toContainText("Total Assets");
  await page.getByTestId("fc-horizon-select").click();
  await page.getByRole("button", { name: "24 months", exact: true }).click();
  await expect(page.getByTestId("fc-basis")).toContainText("Sep 2028");
});

test("the report includes the forecast", async ({ page }) => {
  await page.goto("/demo/reports");
  await expect(page.locator('[data-section="forecast"]')).toContainText("Revenue, next 12 months");
  await expect(page.getByTestId("report-fc-table")).toContainText("Net profit");
});

test("the sector tabs switch the side rail, and the old bank address still works", async ({ page }) => {
  await page.goto("/demo/summary");
  // Phones get the sectors as chips above the page; wider screens as tabs in the top bar (wait for either to render).
  // (Both exist in the page; the top-bar tabs come first and are hidden on phones, so wait for the visible one.)
  await expect(page.getByTestId("tab-sales").or(page.getByTestId("sector-sales")).filter({ visible: true }).first()).toBeVisible();
  const desktop = await page.getByTestId("tab-sales").isVisible();
  if (desktop) await expect(page.getByTestId("tab-financials")).toHaveAttribute("aria-current", "page");
  await page.getByTestId(desktop ? "tab-sales" : "sector-sales").click();
  await expect(page).toHaveURL(/\/demo\/sales/);
  if (desktop) await expect(page.getByTestId("tab-sales")).toHaveAttribute("aria-current", "page");
  await page.goto("/demo/analysis/bank?type=month");
  await expect(page).toHaveURL(/\/demo\/banking\?type=month/);
  if (desktop) await expect(page.getByTestId("tab-banking")).toHaveAttribute("aria-current", "page");
});

test("demo sales reconcile to the P&L and break down by category, product and customer", async ({ page }) => {
  await page.goto("/demo/sales");
  await expect(page.getByTestId("sales-headline")).toContainText("EGP 1,066,138");
  await expect(page.getByTestId("tile-sales")).toContainText("EGP 1,066,138");
  await expect(page.getByTestId("sales-reconciled")).toBeVisible();
  await expect(page.getByTestId("category-bars").getByRole("listitem").first()).toBeVisible();
  await page.goto("/demo/sales/products");
  await expect(page.getByTestId("pvm-table")).toContainText("Total change");
  await page.getByTestId("category-bars").getByRole("listitem").first().click();
  await expect(page.getByTestId("category-filter")).toBeVisible();
  await page.goto("/demo/sales/customers");
  await expect(page.getByTestId("customer-table")).toBeVisible();
  await page.goto("/demo/sales/trend");
  await expect(page.getByTestId("reconciliation-table")).toContainText("EGP 1,066,138");
});

test("demo expenses tie to the P&L, by account and supplier, with the entries to check", async ({ page }) => {
  await page.goto("/demo/expenses");
  await expect(page.getByTestId("expenses-headline")).toContainText("spent");
  await expect(page.getByTestId("tile-costs")).toBeVisible();
  await expect(page.getByTestId("expenses-reconciled")).toBeVisible();
  await expect(page.getByTestId("cost-bridge")).toBeVisible();
  await expect(page.getByTestId("flag-double")).toContainText("Paid twice?");
  await expect(page.getByTestId("flag-large")).toContainText("Professional Fees");
  await page.goto("/demo/expenses/accounts");
  await expect(page.getByTestId("account-table")).toContainText("Salaries & Wages");
  await page.goto("/demo/expenses/suppliers");
  await expect(page.getByTestId("supplier-table")).toContainText("Medline Supply");
  await expect(page.getByTestId("source-bars")).toContainText("Vendor bills");
  // Banks are lenders, listed apart from suppliers with their interest and charges.
  await expect(page.getByTestId("lender-table")).toContainText("CIB");
  await expect(page.getByTestId("supplier-table")).not.toContainText("Bank: ");
  await page.goto("/demo/expenses/trend");
  await expect(page.getByTestId("expenses-month-table")).toBeVisible();
});

test("vendor bills are read as expenses; dropped under My accounts, it offers to switch", async ({ page }) => {
  await toUpload(page, "expenses");
  await page.getByTestId("file-input").setInputFiles(path.join(__dirname, "../fixtures/files/odoo-vendor-bills.xlsx"));
  await expect(page.getByTestId("expenses-only")).toBeVisible();
  await expect(page.getByTestId("expenses-total")).toContainText("126,000");
  await expect(page.getByTestId("error-count")).toHaveText("All good");
  await page.getByTestId("reading-tab-expenses").click();
  await expect(page.getByTestId("sorted-expenses-total")).toContainText("126,000");
  await expect(page.getByTestId("commit-import")).toHaveText(/Create a free account to save/);
  await toUpload(page, "accounts");
  await page.getByTestId("file-input").setInputFiles(path.join(__dirname, "../fixtures/files/odoo-vendor-bills.xlsx"));
  await expect(page.getByTestId("upload-notice")).toContainText("This looks like an expenses file.");
  await page.getByTestId("switch-kind").click();
  await expect(page.getByTestId("upload-notice")).toHaveCount(0);
});

test("cash flow shows each month and the change in cash", async ({ page }) => {
  await page.goto("/demo/analysis/cashflow?type=year");
  await expect(page.getByTestId("tile-dcash")).toBeVisible();
  await expect(page.getByTestId("cash-monthly")).toBeVisible();
  await expect(page.getByTestId("cash-monthly-table").locator("tbody tr").first()).toBeVisible();
});

test("the Data section lists each step in order and each sector's readiness, with templates to download", async ({ page }) => {
  await page.goto("/demo/data");
  await expect(page.getByTestId("step-ledger")).toBeVisible();
  await page.goto("/demo/data/readiness");
  await expect(page.getByTestId("radar-financials")).toBeVisible();
  await expect(page.getByTestId("readiness-sales")).toBeVisible();
  // One upload feeds every sector it can: the accounts reach all five, the ledger's lines reach Expenses.
  for (const s of ["financials", "sales", "expenses", "banking", "forecast"]) await expect(page.getByTestId(`map-accounts-${s}`)).toHaveAttribute("data-on", "1");
  await expect(page.getByTestId("map-ledger-expenses")).toHaveAttribute("data-on", "1");
  const href = await page.getByTestId("template-financials").first().getAttribute("href");
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("spreadsheetml");
  expect(res.headers()["content-disposition"]).toContain("ireport-financials-template");
});

test("Arabic: the page turns right to left, the frame speaks Arabic, and English comes back", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/demo/summary");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.getByTestId("lang-switch").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar-EG");
  await expect(page.getByTestId("tab-sales")).toHaveText("المبيعات");
  await expect(page.getByTestId("period-picker")).toContainText("سبتمبر 2026");
  // The side menu sits on the right in Arabic.
  if (await page.getByTestId("nav-summary").isVisible()) {
    const rail = await page.getByTestId("nav-summary").boundingBox();
    expect(rail!.x).toBeGreaterThan((page.viewportSize()?.width ?? 1280) / 2);
  }
  // The choice is kept on the next page.
  await page.goto("/demo/expenses");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByTestId("lang-switch").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.getByTestId("tab-sales")).toHaveText("Sales");
  expect(errors).toEqual([]);
});

test("Arabic: the Financials pages, KPIs and analyst notes read in Arabic", async ({ page, context, baseURL }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.addCookies([{ name: "lang", value: "ar", url: baseURL! }]);
  await page.goto("/demo/summary");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("الملخص التنفيذي");
  await expect(page.getByTestId("headline")).toContainText("EGP 1,066,138");
  await expect(page.getByTestId("findings-win")).toContainText("الإيرادات أعلى من المستهدف");
  await page.goto("/demo/analysis/kpis");
  await expect(page.getByTestId("kpi-gpm")).toContainText("هامش مجمل الربح");
  await expect(page.getByTestId("kpi-ar_days")).toContainText("يوم");
  await page.getByTestId("kpi-gpm").click();
  await expect(page.getByRole("dialog")).toContainText("مقابل كل 100 EGP");
  await page.keyboard.press("Escape");
  await page.goto("/demo/analysis/financials");
  await expect(page.getByTestId("pl-table")).toContainText("مجمل الربح");
  await page.goto("/demo/analysis/cashflow");
  await expect(page.getByTestId("waterfall")).toContainText("التدفق النقدي التشغيلي");
  expect(errors).toEqual([]);
});

test("Arabic: the Sales and Expenses pages and their notes read in Arabic", async ({ page, context, baseURL }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.addCookies([{ name: "lang", value: "ar", url: baseURL! }]);
  await page.goto("/demo/sales");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("نظرة عامة على المبيعات");
  await expect(page.getByTestId("sales-headline")).toContainText("أصدرت");
  await page.goto("/demo/sales/customers");
  await expect(page.getByTestId("customer-table")).toContainText("العميل");
  await page.goto("/demo/expenses");
  await expect(page.getByTestId("expenses-headline")).toContainText("أنفقت");
  await expect(page.getByTestId("flag-double")).toContainText("مدفوعة مرتين؟");
  await page.goto("/demo/expenses/suppliers");
  await expect(page.getByTestId("lender-table")).toContainText("المصاريف البنكية");
  expect(errors).toEqual([]);
});

test("Arabic: Bank readiness, Real profit, Forecast and Goalseek read in Arabic", async ({ page, context, baseURL }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.addCookies([{ name: "lang", value: "ar", url: baseURL! }]);
  await page.goto("/demo/banking");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("الجاهزية البنكية");
  await expect(page.getByTestId("bank-basis")).toContainText("12 شهرًا حتى سبتمبر 2026");
  await expect(page.getByTestId("bank-ratios")).toContainText("تغطية خدمة الدين");
  await expect(page.getByTestId("bank-memo")).toContainText("ابدأ بـ");
  await expect(page.getByTestId("stress-table")).toContainText("السيناريو");
  await expect(page.getByTestId("breaking-points")).toContainText("المبيعات");
  await expect(page.getByTestId("bank-checklist")).not.toContainText("Audited");
  await page.getByTestId("assume-requestAmount").fill("3000000");
  await page.getByTestId("assume-requestType").selectOption("term_loan");
  await expect(page.getByTestId("proforma")).toContainText("مع التسهيل الجديد");
  await page.goto("/demo/analysis/real-profit");
  await expect(page.getByTestId("real-bridge")).toContainText("الربح الحقيقي بأسعار اليوم");
  await expect(page.getByTestId("collection")).toContainText("نسبة التحصيل");
  await expect(page.getByTestId("real-memo")).not.toContainText("The largest");
  await page.goto("/demo/analysis/forecast");
  await expect(page.getByTestId("fc-basis")).toContainText("طريقة الإيرادات");
  await expect(page.getByTestId("fc-accuracy")).toContainText("ما مدى دقة هذا؟");
  await expect(page.getByTestId("fc-table")).toContainText("مجمل الربح");
  await page.goto("/demo/analysis/goalseek");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("البحث عن الهدف");
  await expect(page.getByTestId("lever-price")).toContainText("السعر");
  await expect(page.getByText("حساسية عالية", { exact: false })).toBeVisible();
  expect(errors).toEqual([]);
});

test("inventory upload: each sheet goes to Inventory only", async ({ page }) => {
  await page.goto("/demo/data/upload");
  await page.getByTestId("pick-inventory").click();
  await expect(page.getByTestId("get-odoo")).toContainText("import-compatible export");
  await page.getByTestId("wiz-next").click();
  await page.getByTestId("file-input").setInputFiles({ ...STOCK_FILE, buffer: await stockWorkbook() });
  await expect(page.getByTestId("inventory-only")).toBeVisible();
  // Both sheets are read as Inventory sheets, and nothing goes to sales, expenses or the accounts.
  const roles = page.getByTestId("sheet-roles");
  await expect(roles).toContainText("3 valuation layers, net value EGP 700");
  await expect(roles).toContainText("4 done moves");
  await expect(page.getByTestId("inventory-preview")).toContainText("1 rental");
  await expect(page.getByTestId("rental-location-select")).toBeVisible();
  await expect(page.getByTestId("commit-import")).toHaveText(/Create a free account to save/);
});

test("inventory pages show the demo stock and every tie-out green", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("/demo/inventory");
  await expect(page.getByTestId("inv-headline")).toBeVisible();
  await expect(page.getByTestId("inv-tiles")).toBeVisible();
  await expect(page.getByTestId("inv-bridge")).toBeVisible();
  await expect(page.getByTestId("inv-tieouts")).toContainText("All checks agree with the accounts");
  await page.goto("/demo/inventory/products");
  const rows = page.getByTestId("inv-products").getByTestId("inv-product-row");
  expect(await rows.count()).toBeGreaterThanOrEqual(6);
  await expect(page.getByTestId("inv-products").getByTestId("abc-A").first()).toBeVisible();
  await page.goto("/demo/inventory/movements");
  await expect(page.getByTestId("inv-movements")).toBeVisible();
  await expect(page.getByTestId("inv-locations")).toContainText("WH/Rental");
  await page.goto("/demo/inventory/valuation");
  await expect(page.getByTestId("inv-layers")).toBeVisible();
  const table = page.getByTestId("inv-tieout-table");
  await expect(table.getByTestId("tie-ok").first()).toBeVisible();
  await expect(table.getByTestId("tie-off")).toHaveCount(0);
  // Data health shows the same checks.
  await page.goto("/demo/data/checks");
  await expect(page.getByTestId("stock-checks").getByTestId("tie-ok").first()).toBeVisible();
  await expect(page.getByTestId("stock-checks").getByTestId("tie-off")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("payments pages show the demo receivables, payables and payments, tied to the books", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("/demo/payments");
  await expect(page.getByTestId("payments-headline")).toContainText("Customers owe");
  await expect(page.getByTestId("tieout-receivable")).toHaveAttribute("data-status", "ok");
  await expect(page.getByTestId("tieout-payable")).toHaveAttribute("data-status", "ok");
  await page.goto("/demo/payments/receivables");
  await expect(page.getByTestId("ageing-table")).toContainText("Northside Hospital");
  await page.getByTestId("partner-search").fill("river");
  await expect(page.getByTestId("ageing-table").locator("tbody tr")).toHaveCount(1);
  await page.goto("/demo/payments/payables");
  await expect(page.getByTestId("ageing-table")).toContainText("Medline Supply");
  await page.goto("/demo/payments/flows");
  await expect(page.getByTestId("flows-journals")).toContainText("Bank");
  expect(errors).toEqual([]);
});

test("preflight: a messy sales file is checked sheet by sheet, and the screen fits a phone", async ({ page }) => {
  await page.goto("/demo/data/upload");
  await page.getByTestId("pick-sales").click();
  await page.getByTestId("wiz-next").click();
  const csv = ["Sales – September,,", ",,", "Date,Customer,Untaxed Amount", "2026-09-01,Alpha,100", "2026-09-01,Alpha,100", "Total,,200"].join("\n");
  await page.getByTestId("file-input").setInputFiles({ name: "messy.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
  await expect(page.getByTestId("preflight-sheet")).toHaveAttribute("data-status", "ready_after_fixes");
  await expect(page.getByTestId("preflight-continue")).toBeDisabled();
  await page.getByTestId("preflight-dups-keep_all").check();
  await expect(page.getByTestId("preflight-continue")).toBeEnabled();
  // Nothing on the screen is wider than the phone (no sideways scrolling of the page).
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByTestId("preflight-continue").click();
  await expect(page.getByTestId("sales-total")).toContainText("200");
});

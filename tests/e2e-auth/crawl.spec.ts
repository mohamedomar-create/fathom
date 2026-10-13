import { expect, test } from "@playwright/test";
import { brokenLinks, expectClean, inspect, internalLinks, textAndLayout, type PageIssues } from "../e2e/crawl-helpers";
import { createCompany, importFiles, newEmail, requireLocalStack, signUp } from "./helpers";

requireLocalStack();

const ANALYSIS = ["summary", "analysis/kpis", "analysis/explorer", "analysis/profitability", "analysis/cashflow", "analysis/growth", "analysis/trend", "analysis/goalseek", "analysis/forecast", "analysis/financials", "banking", "analysis/real-profit", "sales", "sales/products", "sales/customers", "sales/trend"];
const SETTINGS = ["settings/data-setup", "settings/profile", "settings/source-data", "settings/data-health", "settings/chart-of-accounts", "settings/kpis", "settings/targets", "settings/alerts"];
const ACCOUNT = ["/companies", "/dashboard", "/account", "/admin/organisation", "/admin/people"];

test("every signed-in page opens cleanly, with data and without", async ({ page }) => {
  test.setTimeout(300_000);
  await signUp(page, { name: "Crawl Owner", org: "Crawl Advisory", email: newEmail("crawl") });
  const empty = await createCompany(page, "Empty Co");
  const full = await createCompany(page, "Full Co");
  await importFiles(page, full, ["odoo-pl-bs.xlsx"]);

  const all: PageIssues[] = [];
  for (const u of ACCOUNT) all.push(await inspect(page, u));
  for (const p of [...ANALYSIS, "reports", ...SETTINGS]) all.push(await inspect(page, `/company/${full}/${p}`));
  for (const p of ["type=quarter", "type=year", "cmp=prior", "cmp=ly"]) all.push(await inspect(page, `/company/${full}/summary?${p}`));
  // A company with no figures yet must explain what to do, never crash or show broken numbers.
  for (const p of [...ANALYSIS, "reports", ...SETTINGS]) all.push(await inspect(page, `/company/${empty}/${p}`));

  // The report editor and its published page.
  await page.goto(`/company/${full}/reports`);
  await page.getByTestId("create-report").click();
  await expect(page).toHaveURL(/\/reports\/[0-9a-f-]{36}$/);
  all.push(await inspect(page, page.url()));
  await page.getByRole("button", { name: "Publish report" }).click();
  const link = await page.locator('input[readonly][value*="/r/"]').inputValue();
  all.push(await inspect(page, link));

  const links = new Set<string>();
  for (const u of [...ACCOUNT, `/company/${full}/summary`, `/company/${full}/settings/profile`, `/company/${empty}/summary`]) {
    await page.goto(u);
    for (const l of await internalLinks(page)) links.add(l);
  }
  all.push({ url: `${links.size} signed-in links`, issues: await brokenLinks(page.request, [...links]) });
  expectClean(all);
});

test("the navigation rail and menus take a user everywhere", async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, { name: "Nav Owner", org: "Nav Advisory", email: newEmail("nav") });
  const id = await createCompany(page, "Nav Co");
  await importFiles(page, id, ["odoo-pl-bs.xlsx"]);
  await page.goto(`/company/${id}/summary`);

  const issues: string[] = [];
  page.on("pageerror", (e) => issues.push(`script error: ${e.message}`));
  // Each analysis view by clicking its link in the rail, as a user would.
  for (const p of ANALYSIS) {
    // The rail lists the current sector's pages; another sector is reached through its tab first.
    const link = page.locator(`a[href$="/company/${id}/${p}"]`).first();
    if (!(await link.isVisible())) await page.getByTestId(`tab-${p.startsWith("sales") ? "sales" : p === "banking" ? "banking" : "financials"}`).click();
    await page.locator(`a[href$="/company/${id}/${p}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`/company/${id}/${p}`));
    await expect(page.locator("h1")).toBeVisible();
    for (const i of await textAndLayout(page)) issues.push(`${p}: ${i}`);
  }
  // The period picker carries the chosen period from page to page.
  await page.getByTestId("tab-financials").click();
  await page.getByTestId("period-type").click();
  await page.getByRole("button", { name: "Quarter", exact: true }).click();
  await expect(page).toHaveURL(/type=quarter/);
  await page.locator(`a[href*="/company/${id}/analysis/profitability"]`).first().click();
  await expect(page).toHaveURL(/analysis\/profitability.*type=quarter/);
  // The user menu reaches the account page.
  await page.getByTestId("user-menu").click();
  await page.getByRole("link", { name: /account/i }).first().click();
  await expect(page).toHaveURL(/\/account/);
  expect(issues).toEqual([]);
});

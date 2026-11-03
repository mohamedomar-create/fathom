import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { createCompany, fixture, importFiles, newEmail, requireLocalStack, signUp, startUpload } from "./helpers";

requireLocalStack();
const sql = (q: string) => execFileSync("psql", [process.env.DB_URL ?? "postgres://postgres:postgres@127.0.0.1:54322/postgres", "-Atq", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" }).trim();

/** Financial data (the budget page needs it), a sales file (products and customers) and a vendor-bills file (expense accounts). */
async function loadData(page: Page, id: string) {
  await importFiles(page, id, ["odoo-pl-bs.xlsx"]);
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
}

test("setup: top products ticked, a group created with a product and a customer, a rental product confirmed, two expenses merged; saved and reloaded the same", async ({ page }) => {
  test.setTimeout(240_000);
  await signUp(page, { name: "Builder Owner", org: "Builder Org", email: newEmail("builder") });
  const id = await createCompany(page, "Builder Co");
  await loadData(page, id);

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

test("a version from the setup: revenue row +10% equals estimate × 1.1, a month edit keeps the year as months sum, units × price on a product, a customer edit shows the difference and Balance clears it, approve locks every input; Financials Budget comparison reads the saved lines", async ({ page }) => {
  test.setTimeout(300_000);
  await signUp(page, { name: "Sheet Owner", org: "Sheet Org", email: newEmail("bsheet") });
  const id = await createCompany(page, "Sheet Co");
  await loadData(page, id);
  // The financial year starts in March: this year (FY 2025) holds the sales of Jan-Feb 2026 and the budget year (FY 2026,
  // Mar 2026 - Feb 2027) has actual figures up to Sep 2026, so Financials can compare with it.
  sql(`update public.companies set fy_start_month = 3 where id = '${id}'`);
  const setup = {
    products: ["CPAP Machine", "Pulse Oximeter"],
    groups: [{ id: "cons", name: "Consumables", products: ["Full Face Mask"], customers: [] }, { id: "hosp", name: "Hospitals", products: [], customers: ["Hilltop Hospital"] }],
    streams: { rental: ["CPAP Machine"] }, expenses: { merged: [], excluded: [] },
  };
  sql(`insert into public.budget_setups (company_id, setup) values ('${id}', '${JSON.stringify(setup)}'::jsonb)`);

  await page.goto(`/company/${id}/analysis/budget`);
  await expect(page.getByTestId("bsetup-step-1")).toHaveCount(0);
  await page.getByTestId("budget-new").click();
  await page.getByTestId("budget-fy").selectOption("2026");
  await page.getByTestId("budget-from-setup").check();
  await page.getByTestId("budget-create").click();
  await expect(page.getByTestId("btab-revenue")).toBeVisible({ timeout: 20_000 });
  const v = sql(`select id from public.budget_versions where company_id = '${id}'`);
  const rowsOf = (view: string) => Number(sql(`select count(*) from public.budget_rows where version_id = '${v}' and view = '${view}'`));
  expect(rowsOf("revenue")).toBe(3); // CPAP, Pulse Oximeter, Consumables
  expect(rowsOf("customer")).toBe(3);
  expect(rowsOf("expense")).toBeGreaterThan(0);
  expect(sql(`select setup->'products'->>0 from public.budget_versions where id = '${v}'`)).toBe("CPAP Machine");
  const yearOf = (key: string, view = "revenue") => Number(sql(`select (select sum(m) from unnest(months) m) from public.budget_rows where version_id = '${v}' and view = '${view}' and key = '${key}'`));
  // The new year starts equal to this year's estimate (CPAP: 52,000 + 81,000 in Jan-Feb 2026).
  expect(yearOf("prod:CPAP Machine")).toBe(133000);

  // The cards, compact amounts (exact on hover and while typing), the chart, sort and the search box.
  for (const k of ["revenue", "gp", "exp", "np"]) await expect(page.getByTestId(`bcards-${k}`)).toBeVisible();
  await expect(page.getByTestId("bcards-revenue")).toContainText("This year's estimate");
  await expect(page.getByTestId("bchart-revenue")).toBeVisible();
  const cpap = page.getByTestId("bsheet-input-prod:CPAP Machine");
  await expect(cpap).toHaveValue("133K");
  await cpap.focus();
  await expect(cpap).toHaveValue("133,000");
  await cpap.blur();
  await expect(cpap).toHaveValue("133K");
  await expect(page.getByTestId("bsheet-total-new")).toHaveText(/^[\d.]+(K|M)$/);
  expect(await page.getByTestId("bsheet-total-new").getAttribute("title")).toMatch(/^[\d,]+$/);
  await page.getByTestId("bsheet-sort-amount").click();
  const order = await page.locator("[data-testid^=bsheet-row-]").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.replace("bsheet-row-", "")));
  const amounts = await Promise.all(order.map(async (k) => Number((await page.getByTestId(`bsheet-input-${k}`).getAttribute("title"))!.split(" ")[0].replace(/,/g, ""))));
  expect(amounts[0]).toBe(Math.max(...amounts));
  await page.getByTestId("bsheet-sort-name").click();
  await expect(page.locator("[data-testid^=bsheet-row-]").first()).toHaveAttribute("data-testid", "bsheet-row-grp:cons"); // Consumables, CPAP Machine, Pulse Oximeter
  await expect(page.getByTestId("bsheet-search")).toHaveCount(0); // 3 rows: no search box
  await page.getByTestId("btab-expenses").click();
  await expect(page.getByTestId("bchart-expenses")).toBeVisible();
  const expRows = page.locator("[data-testid^=bsheet-row-]");
  const nExp = await expRows.count();
  if (nExp > 15) {
    const label = (await expRows.nth(3).locator("td").first().innerText()).trim().split("\n")[0];
    await page.getByTestId("bsheet-search").fill(label);
    await expect.poll(() => expRows.count()).toBeLessThan(nExp);
    await expect(expRows.first()).toContainText(label);
  } else await expect(page.getByTestId("bsheet-search")).toHaveCount(0);
  for (const k of ["customers", "streams", "groups", "vs"]) {
    await page.getByTestId(`btab-${k}`).click();
    await expect(page.getByTestId(`bchart-${k}`)).toBeVisible();
  }
  await page.getByTestId("btab-revenue").click();

  // +10% on a revenue row; units × price on a product; a month edit on a group.
  await expect(page.getByTestId("bsheet-strip")).toBeVisible();
  const stripBefore = await page.getByTestId("bsheet-strip-revenue").textContent();
  await page.getByTestId("bsheet-input-prod:CPAP Machine").fill("+10%");
  await page.getByTestId("bsheet-input-prod:CPAP Machine").press("Enter");
  await expect(page.getByTestId("bsheet-strip-revenue")).not.toHaveText(stripBefore!);
  await page.getByTestId("bsheet-uxp-prod:Pulse Oximeter").click();
  await page.getByTestId("bsheet-units-prod:Pulse Oximeter").fill("20");
  await page.getByTestId("bsheet-price-prod:Pulse Oximeter").fill("1,500");
  await page.getByTestId("bsheet-price-prod:Pulse Oximeter").press("Enter");
  await page.getByTestId("bsheet-open-grp:cons").click();
  await page.getByTestId("bsheet-month-grp:cons-6").fill("123456"); // Sep 2026
  await page.getByTestId("bsheet-month-grp:cons-6").press("Enter");
  await expect(page.getByTestId("bsheet-auto-grp:cons")).toBeVisible();
  await page.getByTestId("budget-save").click();
  await expect(page.getByTestId("budget-msg")).toContainText("Saved", { timeout: 15_000 });

  expect(yearOf("prod:CPAP Machine")).toBe(146300);
  expect(JSON.parse(sql(`select basis from public.budget_rows where version_id = '${v}' and key = 'prod:CPAP Machine'`))).toEqual({ kind: "pct", value: 10 });
  expect(yearOf("prod:Pulse Oximeter")).toBe(30000);
  expect(JSON.parse(sql(`select basis from public.budget_rows where version_id = '${v}' and key = 'prod:Pulse Oximeter'`))).toEqual({ kind: "units", units: 20, price: 1500 });
  expect(sql(`select mode || '/' || months[7] from public.budget_rows where version_id = '${v}' and key = 'grp:cons'`)).toBe("months/123456");
  expect(yearOf("grp:cons")).toBe(46800 + 123456); // the other months as they were, plus the edited one
  // The revenue lines add up to the revenue rows, month by month.
  const mismatch = sql(`
    with r as (select i, sum(months[i]) v from public.budget_rows, generate_series(1, 12) i where version_id = '${v}' and view = 'revenue' group by i),
         l as (select month as mon, sum(amount) v from public.budget_lines where version_id = '${v}' and key = 'cls:revenue' group by month),
         m as (select i, to_char(date '2026-03-01' + (i - 1) * interval '1 month', 'YYYY-MM') as mon from generate_series(1, 12) i)
    select count(*) from m join r using (i) left join l using (mon) where abs(r.v - coalesce(l.v, 0)) > 0.01`);
  expect(mismatch).toBe("0");

  // Customers: an edit shows the difference; Balance clears it.
  await page.getByTestId("btab-customers").click();
  await expect(page.getByTestId("customer-diff")).toHaveCount(0);
  await page.getByTestId("bsheet-input-cust:Lakeside Medical").fill("+50%");
  await page.getByTestId("bsheet-input-cust:Lakeside Medical").press("Enter");
  await expect(page.getByTestId("customer-diff")).toBeVisible();
  await page.getByTestId("customer-balance").click();
  await expect(page.getByTestId("customer-diff")).toHaveCount(0);
  await page.getByTestId("budget-save").click();
  await expect(page.getByTestId("budget-save")).toHaveCount(0, { timeout: 15_000 }); // saved: nothing left to save
  await expect.poll(() => yearOf("cust:Lakeside Medical", "customer")).toBe(27000);
  const custOff = sql(`
    with c as (select i, sum(months[i]) v from public.budget_rows, generate_series(1, 12) i where version_id = '${v}' and view = 'customer' group by i),
         r as (select i, sum(months[i]) v from public.budget_rows, generate_series(1, 12) i where version_id = '${v}' and view = 'revenue' group by i)
    select count(*) from c join r using (i) where abs(c.v - r.v) > 0.01`);
  expect(custOff).toBe("0");

  // The other views are read-only cuts of the same revenue.
  await page.getByTestId("btab-streams").click();
  await expect(page.getByTestId("bstreams")).toContainText("Rental");
  await page.getByTestId("btab-groups").click();
  await expect(page.getByTestId("bgroups")).toContainText("Consumables");
  await expect(page.getByTestId("bgroups-customers")).toContainText("Hospitals");
  // The customer group holds its customer's budget (Hilltop Hospital's saved year).
  const hilltop = Math.round(yearOf("cust:Hilltop Hospital", "customer"));
  expect(hilltop).toBeGreaterThan(0);
  const hosp = page.getByTestId("bgroups-customers-row").filter({ hasText: "Hospitals" }).locator("td").last().locator("span");
  await expect(hosp).toHaveAttribute("title", hilltop.toLocaleString("en-US"));
  await expect(hosp).toHaveText(/^[\d.]+(K|M)$/);
  await page.getByTestId("btab-expenses").click();
  expect(await page.locator("[data-testid^=bsheet-row-]").count()).toBeGreaterThan(0);

  // Approve: every input goes.
  await page.getByRole("button", { name: "Approve" }).first().click();
  await page.getByTestId("budget-approve").getByTestId("confirm-button").click();
  await expect(page.getByTestId("budget-status")).toContainText("Approved", { timeout: 15_000 });
  for (const tab of ["btab-revenue", "btab-customers", "btab-expenses"]) {
    await page.getByTestId(tab).click();
    expect(await page.locator("[data-testid^=bsheet-row-]").count()).toBeGreaterThan(0);
    await expect(page.locator("[data-testid^=bsheet-input-], [data-testid^=bsheet-select-], [data-testid=bsheet-apply-pct]")).toHaveCount(0);
  }
  await page.getByTestId("btab-revenue").click();
  await page.getByTestId("bsheet-open-grp:cons").click();
  await expect(page.locator("[data-testid^=bsheet-month-]")).toHaveCount(0);
  await expect(page.getByTestId("budget-save")).toHaveCount(0);

  // The company's setup changes later: the version says so and keeps its figures.
  await expect(page.getByTestId("bsetup-drift")).toHaveCount(0);
  sql(`update public.budget_setups set setup = jsonb_set(setup, '{products}', '["CPAP Machine"]') where company_id = '${id}'`);
  await page.reload();
  await expect(page.getByTestId("bsetup-drift")).toBeVisible();
  expect(yearOf("prod:CPAP Machine")).toBe(146300);

  // Financials: the Budget comparison reads the saved lines (Sep 2026 revenue = the month typed above).
  await page.goto(`/company/${id}/analysis/financials`);
  await page.getByTestId("fin-compare").click();
  await page.getByRole("button", { name: "Budget", exact: true }).click();
  await expect(page.getByTestId("pl-table").locator("thead")).toContainText("Budget");
  await expect(page.getByTestId("pl-table").locator('tr[data-line="revenue"] td').nth(2)).toHaveText(/123,456|123K|123\.5K/);
});

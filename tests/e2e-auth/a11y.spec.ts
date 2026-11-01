// Phase 4b: WCAG 2.2 AA on the signed-in pages a demo cannot show (companies, account, organisation, Odoo, end users,
// a company with data, an empty company, a cash book), in English and Arabic.
import { expect, test } from "@playwright/test";
import { axeViolations } from "../e2e/crawl-helpers";
import { createCompany, importFiles, newEmail, requireLocalStack, signUp } from "./helpers";

requireLocalStack();

test("signed-in pages meet WCAG 2.2 AA in English and Arabic", async ({ page, context, baseURL }) => {
  test.setTimeout(600_000);
  await signUp(page, { name: "A11y Owner", org: "A11y Advisory", email: newEmail("a11y") });
  const empty = await createCompany(page, "A11y Empty Co");
  const full = await createCompany(page, "A11y Full Co");
  await importFiles(page, full, ["odoo-pl-bs.xlsx"]);
  await page.goto("/companies");
  await page.getByTestId("add-company").click();
  await page.getByTestId("tile-simple").click();
  await page.getByLabel("Company name").fill("A11y Kiosk");
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(/\/cash\/[0-9a-f-]{36}$/);
  const cash = page.url().match(/\/cash\/([0-9a-f-]{36})/)![1];
  const urls = [
    "/companies", "/dashboard", "/account", "/admin/organisation", "/admin/people",
    `/company/${empty}/summary`, `/company/${empty}/data`, `/company/${empty}/data/odoo`, `/company/${empty}/data/end-users`,
    `/company/${full}/summary`, `/company/${full}/analysis/kpis`, `/company/${full}/data`, `/company/${full}/data/checks`, `/company/${full}/data/upload`,
    `/company/${full}/settings/profile`, `/company/${full}/reports`,
    `/cash/${cash}`, `/cash/${cash}/entries`, `/cash/${cash}/upload`, `/cash/${cash}/settings`,
  ];
  const all: string[] = [];
  for (const lang of ["en", "ar"]) {
    await context.addCookies([{ name: "lang", value: lang, url: baseURL! }]);
    for (const u of urls) all.push(...(await axeViolations(page, u)).map((v) => `[${lang}] ${v}`));
  }
  expect(all, all.join("\n")).toEqual([]);
});

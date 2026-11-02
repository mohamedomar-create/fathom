// Highlighted statements (0050): totals shaded, changes shown better/worse, an editor's colour mark kept for everyone
// (screen and report), the flag thresholds saved per company, and viewers see marks without being able to change them.
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { createCompany, importFiles, localEnv, newEmail, requireLocalStack, signUp } from "./helpers";

requireLocalStack();
const DB = localEnv("LOCAL_DB_URL") || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-Atq", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" }).trim();

test("an editor marks a statement line; it stays, shows in the report, and a viewer sees it but cannot change it", async ({ page, browser }) => {
  test.slow();
  const owner = newEmail("hlowner");
  await signUp(page, { name: "Hala Owner", org: "Highlight Advisory", email: owner });
  const id = await createCompany(page, "Highlight Trading");
  await importFiles(page, id, ["odoo-pl-bs.xlsx"]);

  await page.goto(`/company/${id}/analysis/financials`);
  const pl = page.getByTestId("pl-table");
  await expect(pl.locator('tr[data-line="net_income"]')).toHaveClass(/grand/);
  await expect(pl.locator('tr[data-line="gross_profit"]')).toHaveClass(/sub/);
  await expect(pl.locator('tr[data-line="revenue"]')).not.toHaveClass(/sub|grand/);

  // Mark Gross Profit yellow with a note; it is kept after a reload.
  const gp = pl.locator('tr[data-line="gross_profit"]');
  await gp.getByTestId("mark-btn").click();
  await page.getByTestId("mark-yellow").click();
  await page.getByTestId("mark-note").fill("watch margin");
  await page.getByTestId("mark-save").click();
  await expect(gp).toHaveClass(/mk-yellow/);
  await page.reload();
  await expect(page.getByTestId("pl-table").locator('tr[data-line="gross_profit"]')).toHaveClass(/mk-yellow/);

  // The thresholds are saved for the company.
  await page.goto(`/company/${id}/settings/kpis`);
  await page.getByTestId("hl-pct").fill("10");
  await page.getByTestId("hl-amount").fill("1000");
  await page.getByTestId("hl-save").click();
  await expect(page.getByTestId("hl-msg")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByTestId("hl-pct")).toHaveValue("10");
  await expect(page.getByTestId("hl-amount")).toHaveValue("1000");

  // A report shows the same mark and shading.
  await page.goto(`/company/${id}/reports`);
  await page.getByTestId("create-report").click();
  await expect(page).toHaveURL(/\/reports\/[0-9a-f-]{36}$/);
  await expect(page.locator('[data-section="pl"] tr[data-line="gross_profit"]').first()).toHaveClass(/mk-yellow/, { timeout: 15_000 });
  await expect(page.locator('[data-section="pl"] tr[data-line="net_income"]').first()).toHaveClass(/grand/);
  // The note is printed under the table, so the PDF explains the colour.
  await expect(page.locator('[data-section="pl"] [data-testid="statement-notes"]').first()).toContainText("watch margin");

  // A viewer sees the mark, with no way to change it.
  const ctx = await browser.newContext();
  const viewer = await ctx.newPage();
  const vEmail = newEmail("hlviewer");
  await signUp(viewer, { name: "Vera Viewer", org: "Viewer Home", email: vEmail });
  sql(`insert into public.memberships (org_id, user_id, role) select c.org_id, u.id, 'viewer' from public.companies c, auth.users u where c.id = '${id}' and u.email = '${vEmail}'`);
  await viewer.goto(`/company/${id}/analysis/financials`);
  const vgp = viewer.getByTestId("pl-table").locator('tr[data-line="gross_profit"]');
  await expect(vgp).toHaveClass(/mk-yellow/);
  await expect(vgp.getByTestId("mark-dot")).toBeVisible();
  await expect(viewer.getByTestId("mark-btn")).toHaveCount(0);
  await ctx.close();
});

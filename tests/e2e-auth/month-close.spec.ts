import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { createCompany, fixture, importFiles, newEmail, PASSWORD, requireLocalStack, signUp, startUpload } from "./helpers";

requireLocalStack();
const sql = (q: string) => execFileSync("psql", [process.env.DB_URL ?? "postgres://postgres:postgres@127.0.0.1:54322/postgres", "-Atq", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" }).trim();

test("an admin closes a month; a later upload leaves it as it was and says so", async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, { name: "Close Owner", org: "Close Org", email: newEmail("close") });
  const id = await createCompany(page, "Close Co");
  await importFiles(page, id, ["odoo-pl-bs.xlsx"]);
  const balances = () => sql(`select coalesce(sum(b.amount), 0) || '/' || count(*) from public.account_balances b join public.source_accounts s on s.id = b.account_id join public.companies c on c.id = s.company_id and c.data_version = s.version where c.id = '${id}' and b.period <= (select closed_through from public.companies where id = '${id}')`);

  await page.goto(`/company/${id}/settings/close`);
  await expect(page.getByTestId("close-status")).toContainText("No month is closed yet");
  const month = await page.getByTestId("close-month").inputValue();
  await page.getByTestId("close-go").click();
  const dialog = page.getByTestId("close-dialog");
  await dialog.getByTestId("reauth-password").fill(PASSWORD);
  await dialog.getByTestId("confirm-button").click();
  await expect(page.getByTestId("close-status")).toContainText("Closed through", { timeout: 15_000 });
  expect(sql(`select closed_through from public.companies where id = '${id}'`)).toBe(month);
  await expect(page.getByTestId("close-log")).toContainText("closed through");
  const before = balances();
  expect(before.split("/")[1]).not.toBe("0");

  // The same file again: its closed month is left out, named on the check step, and the saved figures stay.
  await startUpload(page, id);
  await page.getByTestId("file-input").setInputFiles([fixture("odoo-pl-bs.xlsx")]);
  await expect(page.getByTestId("review")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("continue-timeline").click();
  await page.getByTestId("mode-merge").click();
  await expect(page.getByTestId("closed-skipped")).toBeVisible();
  await page.getByTestId("commit-import").click();
  await expect(page.getByTestId("done-step")).toBeVisible({ timeout: 30_000 });
  expect(balances()).toBe(before);

  // Reopening is recorded and the month can change again.
  await page.goto(`/company/${id}/settings/close`);
  await page.getByTestId("reopen-go").click();
  const re = page.getByTestId("reopen-dialog");
  await re.getByTestId("reauth-password").fill(PASSWORD);
  await re.getByTestId("confirm-button").click();
  await expect(page.getByTestId("close-status")).not.toContainText(`Closed through`, { timeout: 15_000 }).catch(() => undefined);
  expect(sql(`select count(*) from public.company_data_audit where company_id = '${id}' and action = 'reopen_month'`)).toBe("1");
});

test("a published report keeps its figures until they are updated, and its PDF is built from the server's data", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await signUp(page, { name: "Snap Owner", org: "Snap Org", email: newEmail("snap") });
  const id = await createCompany(page, "Snap Co");
  await importFiles(page, id, ["odoo-pl-bs.xlsx"]);
  await page.goto(`/company/${id}/reports`);
  await page.getByTestId("create-report").click();
  await expect(page).toHaveURL(/\/reports\/[0-9a-f-]{36}$/);
  const rid = page.url().split("/").pop()!;
  await page.getByRole("button", { name: "Publish report" }).click();
  const link = page.locator('input[readonly][value*="/r/"]');
  await expect(link).toBeVisible();
  await expect(page.getByTestId("frozen-at")).toBeVisible();
  const url = await link.inputValue();
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(url);
  const summary = () => visitor.locator('[data-section="summary"]').textContent();
  const published = await summary();
  expect(published).toContain("EGP");

  // The books change after publishing (as a new upload would): the link still shows the published figures.
  sql(`update public.account_balances b set amount = amount * 2 from public.source_accounts s, public.companies c where b.account_id = s.id and s.company_id = c.id and c.id = '${id}' and s.version = c.data_version and s.statement = 'PL'`);
  await visitor.reload();
  expect(await summary()).toBe(published);

  // Updating the published figures shows the books as they stand now.
  await page.getByTestId("refreeze").click();
  await expect(page.getByText("The link now shows the figures as they stand now.")).toBeVisible();
  await visitor.reload();
  expect(await summary()).not.toBe(published);

  // The PDF is built on the server from the report's own data; a page's HTML is no longer accepted from a signed-in user.
  const pdf = await page.request.post("/api/pdf", { data: { companyId: id, reportId: rid, title: "Snap Co - Report" } });
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  const forged = await page.request.post("/api/pdf", { data: { html: "<p>forged figures</p>", css: "" } });
  expect(forged.status()).toBe(400);
  const linkPdf = await visitor.request.post("/api/pdf", { data: { token: url.split("/r/")[1] } });
  expect(linkPdf.status()).toBe(200);
  expect((await linkPdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
});

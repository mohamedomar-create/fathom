import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { textAndLayout } from "../e2e/crawl-helpers";
import { createCompany, fixture, importFiles, localEnv, newEmail, requireLocalStack, signUp, startUpload } from "./helpers";

requireLocalStack();

/** Problems the persona run found (docs/PERSONA_FIX_PLAN.md), each pinned so it can't come back. */
const sql = (q: string) => execFileSync("psql", [localEnv("LOCAL_DB_URL") || "postgresql://postgres@127.0.0.1:54322/postgres", "-tAqc", q], { encoding: "utf8" }).trim();

test("F1: a hand-edited company or report address is 'not found', never a server error", async ({ page }) => {
  await signUp(page, { name: "Fay One", org: "F1 Advisory", email: newEmail("f1") });
  const id = await createCompany(page, "F1 Co");
  for (const u of ["/company/not-a-uuid/summary", `/company/${"9".repeat(300)}/sales`, `/company/${id}/reports/not-a-uuid`]) {
    const res = await page.goto(u);
    expect(res?.status(), u).toBe(404);
  }
});

test("F2: an invited editor who runs no organisation gets an explanation on the admin pages, not a crash", async ({ browser }) => {
  const owner = await (await browser.newContext()).newPage();
  await signUp(owner, { name: "Owner Two", org: "F2 Advisory", email: newEmail("f2o") });
  const editor = newEmail("f2e");
  await owner.goto("/admin/people");
  await owner.getByPlaceholder("colleague@firm.com").fill(editor);
  await owner.locator("select").first().selectOption("editor");
  await owner.getByRole("button", { name: "Invite a person" }).click();
  await expect(owner.getByRole("cell", { name: editor })).toBeVisible();

  const page = await (await browser.newContext()).newPage();
  await signUp(page, { name: "Eddie Two", org: "Eddie Org", email: editor });
  // Joining by invitation leaves this person an editor only, admin of nothing.
  sql(`delete from public.memberships where user_id=(select id from auth.users where email='${editor}') and role='admin'`);
  for (const u of ["/admin/people", "/admin/organisation"]) {
    const res = await page.goto(u);
    expect(res?.status(), u).toBe(200);
    await expect(page.getByTestId("not-org-admin")).toBeVisible();
  }
});

test("F3: saving after the session ended says to sign in again, with a way back", async ({ page }) => {
  await signUp(page, { name: "Fay Three", org: "F3 Advisory", email: newEmail("f3") });
  const id = await createCompany(page, "F3 Co");
  await page.goto(`/company/${id}/settings/profile`);
  await page.getByLabel("Company name").fill("F3 Co Renamed");
  await page.context().clearCookies();
  await page.getByRole("button", { name: "Save profile" }).click();
  const box = page.getByTestId("session-ended");
  await expect(box).toBeVisible({ timeout: 15_000 });
  await expect(box.getByRole("link")).toHaveAttribute("href", new RegExp(`/login\\?next=.*${id}`));
  await expect(page.getByTestId("section-error")).toHaveCount(0);
});

test("F4 + F5: Create report makes one report however fast it is clicked, and a report can be deleted", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, { name: "Fay Four", org: "F4 Advisory", email: newEmail("f4") });
  const id = await createCompany(page, "F4 Co");
  await importFiles(page, id, ["odoo-pl-bs.xlsx"]);
  await page.goto(`/company/${id}/reports`);
  await page.getByTestId("create-report").dblclick();
  await expect(page).toHaveURL(/\/reports\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await page.waitForTimeout(2000);
  expect(sql(`select count(*) from public.reports where company_id='${id}'`)).toBe("1");

  await page.getByRole("button", { name: "Publish report" }).click();
  const link = await page.locator('input[readonly][value*="/r/"]').inputValue();
  await page.getByTestId("delete-report").click();
  await page.getByTestId("delete-report-dialog").getByTestId("confirm-button").click();
  await expect(page).toHaveURL(new RegExp(`/company/${id}/reports$`), { timeout: 15_000 });
  expect(sql(`select count(*) from public.reports where company_id='${id}'`)).toBe("0");
  expect((await page.goto(link))?.status()).toBe(404);
});

test("F6: the summary before saving an accounts file counts accounts and months, not '0 rows'", async ({ page }) => {
  await signUp(page, { name: "Fay Six", org: "F6 Advisory", email: newEmail("f6") });
  const id = await createCompany(page, "F6 Co");
  await startUpload(page, id);
  await page.getByTestId("file-input").setInputFiles(fixture("odoo-pl-bs.xlsx"));
  await expect(page.getByTestId("review")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("continue-timeline").click();
  await expect(page.getByTestId("preflight-summary-rows")).toHaveText(/\d+ accounts × \d+ months/);
});

test("F7: bar labels stay on the page when a list has refunds, on a desktop and a 320-pixel phone", async ({ browser }) => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 320, height: 640 }]) {
    const page = await (await browser.newContext({ viewport })).newPage();
    await signUp(page, { name: "Fay Seven", org: "F7 Advisory", email: newEmail("f7") });
    const id = await createCompany(page, "F7 Co");
    await startUpload(page, id, "sales");
    await page.getByTestId("file-input").setInputFiles(fixture("odoo-invoice-analysis.xlsx"));
    await page.getByTestId("sales-next").click({ timeout: 20_000 });
    await page.getByTestId("save-sales").click();
    await expect(page.getByTestId("done-step")).toBeVisible({ timeout: 30_000 });
    for (const p of ["sales", "sales/customers", "sales/products"]) {
      await page.goto(`/company/${id}/${p}`);
      await page.waitForLoadState("networkidle");
      expect((await textAndLayout(page)).filter((i) => /wider than screen/.test(i)), `${p} at ${viewport.width}px`).toEqual([]);
    }
  }
});

test("F11 + F12: Arabic Data and Company profile headings are Arabic; a focused field shows a ring", async ({ page }) => {
  await signUp(page, { name: "Fay Eleven", org: "F11 Advisory", email: newEmail("f11") });
  const id = await createCompany(page, "F11 Co");
  await page.goto(`/company/${id}/data`);
  await page.getByTestId("lang-switch").filter({ visible: true }).first().click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  for (const p of ["data", "data/upload", "settings/profile"]) {
    await page.goto(`/company/${id}/${p}`);
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(/^[A-Za-z ]+$/);
  }
  await page.getByTestId("user-menu").click();
  await page.getByTestId("lang-switch").filter({ visible: true }).first().click();
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  const ring = await page.getByLabel("Email").evaluate((el) => { const s = getComputedStyle(el); return s.outlineStyle !== "none" && s.outlineWidth !== "0px"; });
  expect(ring).toBe(true);
});

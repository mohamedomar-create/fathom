// Phase 4a: "Which accounting system?" on Add company and on a company that never said; the Data section's three tabs.
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { newEmail, requireLocalStack, signUp } from "./helpers";

requireLocalStack();
const DB = process.env.DB_URL ?? "postgres://postgres:postgres@127.0.0.1:54322/postgres";

async function add(page: import("@playwright/test").Page, name: string, ...clicks: string[]) {
  await page.goto("/companies");
  await page.getByTestId("add-company").click();
  for (const c of clicks) await page.getByTestId(c).click();
  await page.getByLabel("Company name").fill(name);
  await page.getByRole("button", { name: "Create company" }).click();
}

test("Another system or Excel: no picker on Data, and the upload asks for any program's report or the template", async ({ page }) => {
  await signUp(page, { name: "Sys Owner", org: "Sys Advisory", email: newEmail("sys") });
  await add(page, "Other System Co", "tile-other");
  await expect(page).toHaveURL(/\/company\/[0-9a-f-]{36}\/data$/);
  const id = page.url().match(/\/company\/([0-9a-f-]{36})/)![1];
  await expect(page.getByTestId("data-steps")).toBeVisible();
  await expect(page.getByTestId("system-picker")).toHaveCount(0);
  for (const k of ["steps", "checks", "connections"]) await expect(page.getByTestId(`data-tab-${k}`)).toBeVisible();
  await expect(page.getByTestId("data-tab-steps")).toHaveAttribute("aria-current", "page");
  await page.goto(`/company/${id}/data/upload`);
  await expect(page.getByTestId("data-tab-steps")).toHaveAttribute("aria-current", "page");
  await page.getByTestId("pick-accounts").click();
  await expect(page.getByTestId("get-other")).toContainText("accounting program");
  await expect(page.getByTestId("get-odoo")).toHaveCount(0);
  await page.goto(`/company/${id}/data/end-users`);
  await expect(page.getByTestId("data-tab-connections")).toHaveAttribute("aria-current", "page");
  expect(execFileSync("psql", [DB, "-qAt", "-c", `select kpi_config->'profile'->>'system' from public.companies where id = '${id}'`]).toString().trim()).toBe("other");
});

test("Not sure → 'a notebook of money in and out' → the cash book", async ({ page }) => {
  await signUp(page, { name: "Unsure Owner", org: "Unsure Advisory", email: newEmail("unsure") });
  await add(page, "Unsure Kiosk", "tile-notsure", "keep-notebook");
  await expect(page).toHaveURL(/\/cash\/[0-9a-f-]{36}$/);
});

test("a company made before the picker is asked once on Data; the answer sticks", async ({ page }) => {
  await signUp(page, { name: "Old Owner", org: "Old Advisory", email: newEmail("old") });
  await add(page, "Odoo Files Co", "tile-odoo", "odoo-files");
  await expect(page).toHaveURL(/\/company\/[0-9a-f-]{36}\/data$/);
  const id = page.url().match(/\/company\/([0-9a-f-]{36})/)![1];
  execFileSync("psql", [DB, "-q", "-c", `update public.companies set kpi_config = kpi_config #- '{profile,system}' where id = '${id}'`]);
  await page.reload();
  await expect(page.getByTestId("system-picker")).toBeVisible();
  await page.getByTestId("system-other").click();
  await expect(page.getByTestId("system-picker")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("system-picker")).toHaveCount(0);
});

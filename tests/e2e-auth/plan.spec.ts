import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { createCompany, importFiles, newEmail, requireLocalStack, signUp } from "./helpers";

requireLocalStack();
const sql = (q: string) => execFileSync("psql", [process.env.DB_URL ?? "postgres://postgres:postgres@127.0.0.1:54322/postgres", "-Atq", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" }).trim();

test("a business plan from the books: created, edited, saved by itself, still there after a reload, then deleted", async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, { name: "Plan Owner", org: "Plan Org", email: newEmail("plan") });
  const id = await createCompany(page, "Plan Co");
  await importFiles(page, id, ["odoo-pl-bs.xlsx"]);

  await page.goto(`/company/${id}/planning`);
  await expect(page.getByTestId("plan-start")).toBeVisible();
  await page.getByTestId("plan-create").click();
  await expect(page.getByTestId("plan-workspace")).toBeVisible({ timeout: 20_000 });
  expect(sql(`select count(*) from public.business_plans where company_id = '${id}'`)).toBe("1");

  // An edit saves itself about a second later.
  await page.getByTestId("plan-name").fill("Bank plan 2027");
  await expect(page.getByTestId("plan-save-state")).toContainText("All changes saved", { timeout: 15_000 });
  expect(sql(`select data->>'name' from public.business_plans where company_id = '${id}'`)).toBe("Bank plan 2027");

  // Shortening the plan keeps every row in range, and the change survives a reload.
  await page.getByTestId("plan-years").selectOption("3");
  await expect(page.getByTestId("plan-save-state")).toContainText("All changes saved", { timeout: 15_000 });
  await page.reload();
  await expect(page.getByTestId("plan-name")).toHaveValue("Bank plan 2027");
  await expect(page.getByTestId("plan-years")).toHaveValue("3");

  // Two tabs on the same plan: the older tab can't overwrite the newer save; it says so and keeps its edit.
  const other = await page.context().newPage();
  await other.goto(page.url());
  await other.getByTestId("plan-name").fill("Saved in tab B");
  await expect(other.getByTestId("plan-save-state")).toContainText("All changes saved", { timeout: 15_000 });
  await page.getByTestId("plan-name").fill("Stale tab A");
  await expect(page.getByTestId("plan-save-state")).toContainText("changed in another tab", { timeout: 15_000 });
  await expect(page.getByTestId("plan-name")).toHaveValue("Stale tab A");
  expect(sql(`select data->>'name' from public.business_plans where company_id = '${id}'`)).toBe("Saved in tab B");
  await other.close();
  page.once("dialog", (d) => d.accept());
  await page.reload();
  await expect(page.getByTestId("plan-name")).toHaveValue("Saved in tab B");

  // The statements agree after the save round trip.
  await page.getByTestId("plan-tab-statements").click();
  await expect(page.getByTestId("plan-agree")).toBeVisible();

  // Deleting asks first, then the start screen comes back.
  await page.getByTestId("plan-workspace").getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByTestId("plan-delete").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByTestId("plan-start")).toBeVisible({ timeout: 15_000 });
  expect(sql(`select count(*) from public.business_plans where company_id = '${id}'`)).toBe("0");
});

import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/** Signed-in tests run only against the local Supabase (scripts/local-supabase/start.sh), never a real project. */
export const AUTH_ON = process.env.E2E_AUTH === "1";
export function requireLocalStack() {
  test.skip(!AUTH_ON, "Signed-in tests need the local Supabase: run scripts/local-supabase/start.sh and set E2E_AUTH=1");
}

/** A setting of the local stack: from the environment, or from the file start.sh writes. */
export function localEnv(key: string): string {
  if (process.env[key]) return process.env[key]!;
  const file = path.join(__dirname, "../../.local-supabase/env");
  const line = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").find((l) => l.startsWith(`${key}=`)) : undefined;
  return line ? line.slice(key.length + 1) : "";
}

export const PASSWORD = "testpass12345";
let n = 0;
/** A fresh address per call, so runs never collide. */
export const newEmail = (tag: string) => `${tag}-${Date.now().toString(36)}-${n++}@test.local`;
export const fixture = (name: string) => path.join(__dirname, "../fixtures/files", name);

export async function signUp(page: Page, opts: { name: string; org: string; email: string; password?: string; next?: string }) {
  await page.goto(`/login?mode=signup${opts.next ? `&next=${encodeURIComponent(opts.next)}` : ""}`);
  await page.getByLabel("Your name").fill(opts.name);
  await page.getByLabel("Firm or company name").fill(opts.org);
  await page.getByLabel("Email").fill(opts.email);
  await page.getByLabel("Password").fill(opts.password ?? PASSWORD);
  await page.getByRole("button", { name: "Create account" }).last().click();
  await expect(page).toHaveURL(opts.next ? new RegExp(opts.next.replace(/[/?]/g, "\\$&")) : /\/companies/);
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).last().click();
}

export async function signOut(page: Page) {
  await page.getByTestId("user-menu").click();
  await page.getByRole("button", { name: "Logout" }).click();
  await expect(page).toHaveURL(/\/(login)?(\?|$)/);
}

/** Creates an upload company and returns its id. */
export async function createCompany(page: Page, name: string) {
  await page.goto("/companies");
  await page.getByTestId("add-company").click();
  await page.getByRole("button", { name: /Odoo export \(Excel \/ CSV\)/ }).click();
  await page.getByLabel("Company name").fill(name);
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(/\/company\/[0-9a-f-]{36}\/settings\/source-data/);
  return page.url().match(/\/company\/([0-9a-f-]{36})\//)![1];
}

/** Opens the upload, step by step, up to the drop box: what (accounts or sales) → get file → upload. */
export async function startUpload(page: Page, companyId: string, kind: "accounts" | "sales" | "expenses" = "accounts", step?: "financials" | "sales" | "expenses") {
  await page.goto(`/company/${companyId}/settings/source-data${step ? `?step=${step}` : ""}`);
  await page.waitForLoadState("networkidle");
  // A click before the page has hydrated is lost: try again until the next screen shows.
  await expect(async () => {
    if (await page.getByTestId(`pick-${kind}`).isVisible()) await page.getByTestId(`pick-${kind}`).click({ timeout: 2000 });
    if (await page.getByTestId("get-odoo").isVisible()) await page.getByTestId("wiz-next").click({ timeout: 2000 });
    await expect(page.getByTestId("dropzone")).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
}

/** Uploads files on the source-data page and saves the import. */
export async function importFiles(page: Page, companyId: string, files: string[]) {
  await startUpload(page, companyId);
  await page.getByTestId("file-input").setInputFiles(files.map(fixture));
  await expect(page.getByTestId("review")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("continue-timeline").click();
  await expect(page.getByTestId("timeline-step")).toBeVisible();
  await page.getByTestId("commit-import").click();
  await expect(page.getByTestId("done-step")).toBeVisible({ timeout: 30_000 });
}

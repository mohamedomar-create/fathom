import { expect, test } from "@playwright/test";
import { AUTH_ON, createCompany, importFiles, newEmail, requireLocalStack, signUp } from "./helpers";

test.skip(!AUTH_ON, "signed-in tests run against the local stack (E2E_AUTH=1)");
test.beforeAll(() => requireLocalStack());

/** A company that keeps statements, not a General Ledger, can finish setup: step 3 is done and Review can be verified. */
test("a statement-only company walks the Data steps to Review on a statement basis", async ({ page }) => {
  test.setTimeout(180_000);
  page.on("dialog", (d) => d.accept());
  await signUp(page, { name: "Statement Owner", org: "Statement Advisory", email: newEmail("stmt") });
  const id = await createCompany(page, "Statement Co");
  await importFiles(page, id, ["odoo-pl-bs.xlsx"]);
  await page.goto(`/company/${id}/data`);
  const ledger = page.getByTestId("step-ledger");
  await expect(ledger).toHaveAttribute("data-status", /done|issues/, { timeout: 30_000 });
  await expect(ledger).toContainText("Statements (no General Ledger)");
  // Nothing after it waits for a General Ledger any more.
  for (const s of ["tb", "sales", "stock", "ageing", "review"]) await expect(page.getByTestId(`step-${s}`)).not.toHaveAttribute("data-status", "locked");
  await expect(page.getByTestId("data-steps")).not.toContainText("After the General Ledger");
  const review = page.getByTestId("step-review");
  if ((await review.getAttribute("data-status")) === "verified") await expect(page.getByTestId("step-review-detail")).toContainText("statement basis");
  await expect(page.getByTestId("data-next")).toBeVisible();
  // Readiness gives statement advice, never "upload your General Ledger".
  await page.goto(`/company/${id}/data/readiness`);
  await expect(page.getByTestId("readiness-financials")).toBeVisible();
  await expect(page.getByTestId("readiness-financials")).not.toContainText("General Ledger");
});

/** Two settings saved at the same moment from two pages both stick (0044: each save sends only its part). */
test("two settings saved in parallel both stick", async ({ page, context }) => {
  test.setTimeout(180_000);
  page.on("dialog", (d) => d.accept());
  await signUp(page, { name: "Settings Owner", org: "Settings Advisory", email: newEmail("sets") });
  const id = await createCompany(page, "Settings Co");
  await importFiles(page, id, ["odoo-pl-bs.xlsx"]);
  const other = await context.newPage();
  await page.goto(`/company/${id}/settings/profile`);
  await other.goto(`/company/${id}/analysis/real-profit`);
  await page.getByTestId("vat-rate").fill("10");
  await other.getByTestId("assume-inflation").fill("31");
  await Promise.all([
    page.getByRole("button", { name: "Save profile" }).click(),
    other.getByTestId("save-assumptions").click(),
  ]);
  await expect(page.getByText("Saved.")).toBeVisible({ timeout: 15_000 });
  await expect(other.getByTestId("save-assumptions")).toBeDisabled({ timeout: 15_000 });
  await page.reload();
  await other.reload();
  await expect(page.getByTestId("vat-rate")).toHaveValue("10");
  await expect(other.getByTestId("assume-inflation")).toHaveValue("31");
});

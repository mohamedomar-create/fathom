import * as XLSX from "@e965/xlsx";
import { expect, test, type Page } from "@playwright/test";
import { newEmail, requireLocalStack, signUp } from "./helpers";

requireLocalStack();

/** A kiosk's own sheet: one row per movement, money in and money out in their own columns. */
function kioskBook(): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([
    ["Date", "Description", "Category", "In", "Out", "Paid"],
    ["05/01/2026", "Sales", "Drinks", 1000, "", "Yes"],
    ["20/01/2026", "Sales on credit", "Snacks", 500, "", "No"],
    ["01/01/2026", "Rent", "Rent", "", 1200, "Yes"],
    ["03/02/2026", "Sales", "Drinks", 2000, "", "Yes"],
    ["01/02/2026", "Rent", "Rent", "", 1200, "Yes"],
    ["14/03/2026", "Sales", "Snacks", 1000, "", "Yes"],
    ["01/03/2026", "Rent", "Rent", "", 1200, "Yes"],
    ["soon", "Sales", "Drinks", 50, "", ""],
    ["Total", "", "", 4500, 3600, ""],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Book");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const BIG = /General Ledger|Trial Balance|Odoo|chart of accounts|balance sheet|book of record/i;

async function noBigCompanyWords(page: Page, id: string) {
  for (const p of ["", "/in", "/out", "/cash", "/entries", "/upload", "/settings"]) {
    await page.goto(`/cash/${id}${p}`);
    // Stays on its own page (a redirect is named here), then its tabs show; CI runners are slower than local ones.
    await expect(page).toHaveURL(new RegExp(`/cash/${id}${p}(\\?|$)`), { timeout: 15_000 });
    await expect(page.getByTestId("cash-nav")).toBeVisible({ timeout: 15_000 });
    expect(await page.locator("body").innerText(), `/cash/${id}${p}`).not.toMatch(BIG);
  }
}

test("a kiosk: its own cash book, its own sheet, figures, entries, and the way to the full system", async ({ page }) => {
  test.setTimeout(240_000);
  await signUp(page, { name: "Kiosk Owner", org: "Kiosk Advisory", email: newEmail("kiosk") });
  await page.goto("/companies");
  await page.getByTestId("add-company").click();
  await page.getByTestId("tile-simple").click();
  await page.getByLabel("Company name").fill("Corner Kiosk");
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(/\/cash\/[0-9a-f-]{36}$/);
  const id = page.url().match(/\/cash\/([0-9a-f-]{36})/)![1];
  await expect(page.getByTestId("cash-empty")).toBeVisible();
  // The full system's pages send it back to its cash book.
  await page.goto(`/company/${id}/data`);
  await expect(page).toHaveURL(new RegExp(`/cash/${id}$`));

  // Upload the sheet as it is kept: read, skipped rows named, saved.
  await page.goto(`/cash/${id}/upload`);
  await page.getByTestId("cash-file").setInputFiles({ name: "kiosk.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: kioskBook() });
  await expect(page.getByTestId("cash-read-count")).toContainText("7 entries read", { timeout: 15_000 });
  await expect(page.getByTestId("cash-skip-count")).toContainText("2 rows skipped");
  await page.getByTestId("cash-skips").locator("summary").click();
  await expect(page.getByTestId("cash-skips")).toContainText('"soon" is not a date');
  await expect(page.getByTestId("cash-skips")).toContainText("total row");
  await page.getByTestId("cash-save").click();
  await expect(page.getByTestId("cash-saved")).toContainText("Saved 7 entries", { timeout: 30_000 });

  // The overview: money in 4,500, out 3,600, left 900; cash needs the opening cash.
  await page.goto(`/cash/${id}?range=all`);
  await expect(page.getByTestId("cash-summary")).toBeVisible();
  await expect(page.getByTestId("cash-in")).toContainText("4,500");
  await expect(page.getByTestId("cash-out")).toContainText("3,600");
  await expect(page.getByTestId("cash-left")).toContainText("900");
  await expect(page.getByTestId("cash-today")).toHaveAttribute("data-needs", "opening_cash");
  await page.getByTestId("cash-left").getByRole("button").click();
  await expect(page.getByTestId("cash-formula")).toContainText("Money in − Money out");
  await page.keyboard.press("Escape");
  await page.goto(`/cash/${id}/in?range=all`);
  await expect(page.getByTestId("side-unpaid-in")).toContainText("500");

  // Opening cash: 10,000 + 4,000 paid in − 3,600 out = 10,400 (the unpaid 500 is not cash yet).
  await page.goto(`/cash/${id}/settings`);
  await page.getByTestId("cash-set-opening").fill("10000");
  await page.getByTestId("cash-set-opening-day").fill("2025-12-31");
  await page.getByTestId("cash-set-save").click();
  await expect(page.getByTestId("cash-set-msg")).toContainText("Saved.");
  await page.goto(`/cash/${id}/cash`);
  await expect(page.getByTestId("ahead-cash")).toContainText("10,400");
  await expect(page.getByTestId("ahead-method")).toContainText("average of the last three complete months");

  // One entry added, changed and removed by hand.
  await page.goto(`/cash/${id}/entries`);
  await page.getByTestId("add-day").fill("2026-03-20");
  await page.getByTestId("add-direction").selectOption("out");
  await page.getByTestId("add-amount").fill("250");
  await page.getByTestId("add-category").fill("Ice");
  await page.getByTestId("entries-add").click();
  await expect(page.getByTestId("entries-row").filter({ hasText: "Ice" })).toHaveCount(1, { timeout: 15_000 });
  await page.getByTestId("entries-row").filter({ hasText: "Ice" }).getByTestId("entries-edit").click();
  await page.getByTestId("edit-amount").fill("300");
  await page.getByTestId("entries-save").click();
  await expect(page.getByTestId("entries-row").filter({ hasText: "Ice" })).toContainText("300", { timeout: 15_000 });
  await page.getByTestId("entries-row").filter({ hasText: "Ice" }).getByTestId("entries-remove").click();
  await page.getByTestId("entries-remove-dialog").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByTestId("entries-row").filter({ hasText: "Ice" })).toHaveCount(0, { timeout: 15_000 });

  // Nothing on any of its pages speaks of ledgers, trial balances or Odoo.
  await noBigCompanyWords(page, id);

  // To the full system: the entries become its sales and expense lines; and back.
  await page.goto(`/cash/${id}/settings`);
  await page.getByTestId("cash-to-full").click();
  await page.getByTestId("cash-to-full-dialog").getByRole("button", { name: "Switch to the full system" }).click();
  await expect(page).toHaveURL(new RegExp(`/company/${id}`), { timeout: 30_000 });
  await page.goto(`/company/${id}/sales?type=year&end=2026-03`);
  await expect(page.getByTestId("tile-sales")).toContainText("4,500", { timeout: 30_000 });
  await page.goto(`/company/${id}/settings/profile`);
  await page.getByTestId("to-cash").click();
  await page.getByTestId("to-cash-dialog").getByRole("button", { name: "Move to the cash book" }).click();
  await expect(page).toHaveURL(new RegExp(`/cash/${id}$`), { timeout: 30_000 });
  await expect(page.getByTestId("cash-summary")).toBeVisible();

  // The companies list sends it to its cash book.
  await page.goto("/companies");
  await expect(page.getByTestId("cash-card")).toContainText("Corner Kiosk");
});

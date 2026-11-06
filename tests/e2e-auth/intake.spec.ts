import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createCompany, newEmail, requireLocalStack, signUp } from "./helpers";

requireLocalStack();

/** A messy finance workbook: title rows, Arabic headings, a total row, a tab the rules can't place, a notes tab. */
async function workbook(): Promise<string> {
  const XLSX = await import("@e965/xlsx");
  const wb = XLSX.utils.book_new();
  const add = (name: string, rows: unknown[][]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  add("AR", [["Customer balances"], ["As of 31/10/2026"], [], ["Customer", "Invoice", "Invoice date", "Due date", "Amount", "Balance due"],
    ["Nile Hospital", "INV/2026/0101", "05/08/2026", "04/09/2026", 13680, 12000], ["Delta Clinic", "INV/2026/0144", "20/09/2026", "20/10/2026", 5700, 2500], ["Total", null, null, null, 19380, 14500]]);
  add("الموردين", [["المورد", "رقم الفاتورة", "التاريخ", "تاريخ الاستحقاق", "المبلغ المتبقي"], ["شركة النيل", "BILL/2026/0011", "01/07/2026", "31/07/2026", 7000], ["Delta Supplies", "BILL/2026/0019", "10/10/2026", "09/11/2026", 3000]]);
  add("Expenses", [["Date", "Vendor", "Category", "Amount"], ["02/10/2026", "Rent Co", "Rent", 9000], ["05/10/2026", "Power", "Utilities", 1200], ["Total", null, null, 10200]]);
  add("Sales", [["Date", "Invoice", "Customer", "Product", "Quantity", "Untaxed Amount"], ["05/08/2026", "INV/2026/0101", "Nile Hospital", "Ventilator", 1, 12000], ["20/09/2026", "INV/2026/0144", "Delta Clinic", "Mask", 100, 5000]]);
  add("PO", [["PO Number", "Vendor", "PO Date", "Product", "Ordered Quantity", "Received Quantity", "Billed Quantity", "Untaxed Amount"], ["P00001", "Acme", "01/10/2026", "Mask", 10, 8, 5, 1000], ["P00002", "Beta", "15/10/2026", "Pump", 2, 2, 2, 4000]]);
  add("Foglio1", [["Zona", "Bandiera", "Punteggio"], ["N", "x", 3], ["S", "y", 4]]);
  add("Read me", [["Prepared by finance."]]);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "intake-")), "Finance pack.xlsx");
  fs.writeFileSync(file, Buffer.from(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer));
  return file;
}

test("a five-tab workbook: every tab placed, checked, previewed, saved to its module", async ({ page }) => {
  await signUp(page, { name: "Intake Owner", org: "Intake Advisory", email: newEmail("ink") });
  const id = await createCompany(page, "Intake Co");
  await page.goto(`/company/${id}/data`);
  await page.getByTestId("intake-open").click();
  await page.getByTestId("intake-files").setInputFiles(await workbook());

  const review = page.getByTestId("intake-review");
  await expect(review).toBeVisible();
  const piece = (name: string) => page.getByTestId("intake-piece").filter({ has: page.getByRole("heading", { name, exact: true }) });
  await expect(piece("AR")).toHaveAttribute("data-module", "ar_open");
  await expect(piece("الموردين")).toHaveAttribute("data-module", "ap_open");
  await expect(piece("Expenses")).toHaveAttribute("data-module", "expenses");
  await expect(piece("Sales")).toHaveAttribute("data-module", "sales");
  await expect(piece("PO")).toHaveAttribute("data-module", "purchasing");
  await expect(piece("Foglio1")).toHaveAttribute("data-module", "");
  await expect(page.getByTestId("intake-left")).toContainText("Read me");
  // Money in = money out, and the file's own total is checked.
  await expect(piece("AR").getByTestId("intake-proof")).toContainText("14,500");
  await expect(piece("Expenses").getByTestId("intake-rows")).toContainText("2 rows kept · 0 rejected · 1 skipped");
  // Receivables tie to the invoices in the Sales tab.
  await expect(page.getByTestId("intake-check").filter({ hasText: "Receivables against the invoices" })).toHaveAttribute("data-status", "ok");

  // Not ready: the payables list has no as-of day and one tab has no module.
  await expect(page.getByTestId("intake-next")).toBeDisabled();
  await piece("الموردين").getByTestId("intake-asof").fill("2026-10-31");
  await piece("Foglio1").getByTestId("intake-module").selectOption("");
  await expect(page.getByTestId("intake-next")).toBeEnabled();
  await page.getByTestId("intake-next").click();

  await expect(page.getByTestId("intake-preview-table")).toHaveCount(5);
  await page.getByTestId("intake-save").click();
  await expect(page.getByTestId("intake-done")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("intake-done-row")).toHaveCount(5);
  await expect(page.getByTestId("intake-done-row").filter({ hasText: "PO" })).toContainText("2 rows saved");

  // Purchasing exists from its definition alone: its page reads the shared store.
  await page.goto(`/company/${id}/modules/purchasing`);
  await expect(page.getByTestId("module-page")).toBeVisible();
  await expect(page.getByTestId("module-total-value")).toContainText("5,000");
  await expect(page.getByTestId("module-table")).toContainText("P00002");

  // The same layout again goes straight through: every table is sure.
  await page.goto(`/company/${id}/data/intake`);
  await page.getByTestId("intake-files").setInputFiles(await workbook());
  await expect(piece("PO").getByTestId("intake-band")).toHaveText("Sure");
  await expect(piece("PO")).toContainText("Placed the way you placed this layout before.");
});

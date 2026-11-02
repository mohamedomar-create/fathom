import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { createCompany, newEmail, signUp, startUpload } from "./helpers";

/** D3: the Check step says which layout a file was read as; a journal-items list is read as entries; the person can choose. */
test("a journal items export is read as Odoo Journal Items, shown on the Check step, and the reading can be changed", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, { name: "Layout Owner", org: "Layout Advisory", email: newEmail("layout") });
  const id = await createCompany(page, "Layout Co");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Journal Items");
  ws.addRow(["Accounting Date", "Code", "Name", "Label", "Debit", "Credit"]);
  for (const r of [
    ["03/01/2026", "410000", "Revenues", "INV/2026/0001", 0, 1000], ["03/01/2026", "121000", "Bank", "INV/2026/0001", 1000, 0],
    ["15/01/2026", "620100", "Rent", "BILL/2026/0001", 300, 0], ["15/01/2026", "121000", "Bank", "BILL/2026/0001", 0, 300],
    ["02/02/2026", "410000", "Revenues", "INV/2026/0002", 0, 500], ["02/02/2026", "121000", "Bank", "INV/2026/0002", 500, 0],
  ]) ws.addRow(r);
  await startUpload(page, id);
  await page.getByTestId("file-input").setInputFiles({ name: "journal-items.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await wb.xlsx.writeBuffer()) });
  await expect(page.getByTestId("review")).toBeVisible({ timeout: 15_000 });
  const row = page.getByTestId("read-as-Journal Items");
  await expect(row.getByTestId("read-as-source")).toHaveText("Odoo Journal Items");
  await expect(page.getByTestId("balanced")).toContainText(/yes/i);
  // The help names the layouts and offers the sample.
  await page.getByTestId("layouts-help").locator("summary").click();
  await expect(page.getByTestId("template-journal-items")).toHaveAttribute("href", /\/api\/templates\/journal-items/);
  const sample = await page.request.get("/api/templates/journal-items");
  expect(sample.status()).toBe(200);
  // The person can say it is something else; the reading follows.
  await row.getByTestId("read-as-pick").selectOption("trial-balance");
  await expect(row.getByTestId("read-as-source")).not.toHaveText("Odoo Journal Items");
  await row.getByTestId("read-as-pick").selectOption("");
  await expect(row.getByTestId("read-as-source")).toHaveText("Odoo Journal Items");
});

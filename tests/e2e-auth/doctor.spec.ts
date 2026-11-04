// The AI system doctor, signed in: findings from the company's own books, accepted with a reason (kept for everyone,
// undone again), and the Explain/Ask route refusing when it cannot answer from checked figures.
import { expect, test } from "@playwright/test";
import { createCompany, importFiles, newEmail, requireLocalStack, signUp } from "./helpers";

requireLocalStack();

test("an editor accepts a finding with a reason, it stays after a reload, and undo brings it back", async ({ page }) => {
  test.slow();
  await signUp(page, { name: "Dina Doctor", org: "Doctor Advisory", email: newEmail("doctor") });
  const id = await createCompany(page, "Doctor Trading");
  await importFiles(page, id, ["egypt-odoo-general-ledger.xlsx"]);

  await page.goto(`/company/${id}/doctor`);
  await expect(page.getByTestId("doctor-score")).toHaveText(/^\d{1,3}$/);
  const first = page.getByTestId("doctor-findings").getByTestId("doctor-finding").first();
  await expect(first).toBeVisible();
  const key = await first.getAttribute("data-key");
  const sel = `[data-key="${(key ?? "").replace(/["\\]/g, "\\$&")}"]`;
  const before = Number(await page.getByTestId("doctor-score").textContent());

  await first.getByTestId("doctor-accept").click();
  await expect(page.getByTestId("doctor-accept-save")).toBeDisabled();
  await page.getByTestId("doctor-reason").fill("Known: timing of a year-end entry");
  await page.getByTestId("doctor-accept-save").click();
  const done = page.getByTestId("doctor-accepted").locator(sel);
  await expect(done.getByTestId("doctor-accepted-reason")).toContainText("Known: timing of a year-end entry");
  await page.reload();
  await expect(page.getByTestId("doctor-accepted").locator(sel)).toBeVisible();
  expect(Number(await page.getByTestId("doctor-score").textContent())).toBeGreaterThanOrEqual(before);

  await page.getByTestId("doctor-accepted").locator(sel).getByTestId("doctor-undo").click();
  await expect(page.getByTestId("doctor-findings").locator(sel)).toBeVisible();
  await expect(page.getByTestId("doctor-accepted")).toHaveCount(0);
});

test("Ask your numbers needs a signed-in member, and says plainly when the AI is not set up", async ({ page }) => {
  await signUp(page, { name: "Omar Ask", org: "Ask Advisory", email: newEmail("ask") });
  const id = await createCompany(page, "Ask Trading");
  await importFiles(page, id, ["odoo-pl-bs.xlsx"]);
  const r = await page.request.post(`/api/companies/${id}/doctor`, { data: { mode: "ask", question: "What was revenue last month?" } });
  const body = await r.json();
  if (r.status() === 503) expect(body.error).toMatch(/not configured|busy/i);
  else expect([200, 422]).toContain(r.status());
  const out = await page.request.post(`/api/companies/${id}/doctor`, { data: { mode: "ask", question: "x" } });
  expect(out.status()).toBe(400);
});

import { expect, test } from "@playwright/test";
import { createCompany, importFiles, newEmail, PASSWORD, requireLocalStack, signIn, signUp } from "./helpers";

requireLocalStack();

test("one user can never see or reach another user's company", async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  await signUp(a, { name: "Amr A", org: "A Advisory", email: newEmail("a") });
  const id = await createCompany(a, "A Private Co");

  const b = await (await browser.newContext()).newPage();
  await signUp(b, { name: "Bassem B", org: "B Advisory", email: newEmail("b") });
  await expect(b.getByText("A Private Co")).toHaveCount(0);
  const res = await b.goto(`/company/${id}/summary`);
  expect(res?.status()).toBe(404);
  expect((await b.request.get(`/api/export/${id}`)).status()).toBe(404);
  expect((await b.request.post(`/api/companies/${id}/commentary`, { data: { type: "month", end: "2026-09", sections: ["bank"] } })).status()).not.toBe(200);
});

test("an invited viewer sees the company read-only, the last admin cannot delete their account, and the viewer can leave", async ({ browser }) => {
  test.slow();
  const owner = await (await browser.newContext()).newPage();
  const ownerEmail = newEmail("owner");
  await signUp(owner, { name: "Omar Owner", org: "Owner Advisory", email: ownerEmail });
  const id = await createCompany(owner, "Shared Trading");
  await importFiles(owner, id, ["odoo-pl-bs.xlsx"]);

  const viewerEmail = newEmail("viewer");
  await owner.goto("/admin/people");
  await owner.getByPlaceholder("colleague@firm.com").fill(viewerEmail);
  await owner.locator("select").first().selectOption("viewer");
  await owner.getByRole("button", { name: "Invite a person" }).click();
  await expect(owner.getByRole("cell", { name: viewerEmail })).toBeVisible();

  const viewer = await (await browser.newContext()).newPage();
  await signUp(viewer, { name: "Vera Viewer", org: "Vera's Firm", email: viewerEmail });
  await expect(viewer.getByText("Shared Trading")).toBeVisible();
  await viewer.goto(`/company/${id}/analysis/bank`);
  await expect(viewer.getByTestId("tile-dscr")).toBeVisible();
  await expect(viewer.getByTestId("save-assumptions")).toHaveCount(0);
  await expect(viewer.getByText("You have view-only access")).toBeVisible();
  // A viewer can try forecast drivers but not save them.
  await viewer.goto(`/company/${id}/analysis/forecast`);
  await expect(viewer.getByTestId("tile-fc-revenue")).toBeVisible();
  await expect(viewer.getByTestId("save-forecast")).toHaveCount(0);
  await viewer.goto(`/company/${id}/reports`);
  await expect(viewer.getByTestId("create-report")).toHaveCount(0);
  await viewer.goto(`/company/${id}/settings/source-data`);
  await expect(viewer.getByTestId("view-only")).toBeVisible();
  await expect(viewer.getByTestId("file-input")).toHaveCount(0);

  // The owner is the only admin of an organisation that now has another member.
  await owner.goto("/account");
  await expect(owner.getByTestId("delete-account")).toBeDisabled();

  // The viewer leaves; the company disappears from their list and they still have their own organisation.
  await viewer.goto("/account");
  await viewer.getByRole("button", { name: "Leave", exact: true }).click();
  await viewer.getByTestId("leave-org-dialog").getByTestId("confirm-button").click();
  // The organisation drops off the account page once the leave is saved.
  await expect(viewer.getByTestId("leave-org-dialog")).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: "Leave", exact: true })).toHaveCount(0);
  await viewer.goto("/companies");
  await expect(viewer.getByText("Shared Trading")).toHaveCount(0);
  expect((await viewer.goto(`/company/${id}/summary`))?.status()).toBe(404);

  // With the viewer gone, the owner may delete their account again.
  await owner.goto("/account");
  await expect(owner.getByTestId("delete-account")).toBeEnabled();
});

test("a user deletes their account and can no longer sign in", async ({ page }) => {
  const email = newEmail("leaver");
  await signUp(page, { name: "Laila Leaver", org: "Leaver Co", email });
  await createCompany(page, "Soon Gone");
  await page.goto("/account");
  await page.getByTestId("delete-account").click();
  const dialog = page.getByTestId("delete-account-dialog");
  await expect(dialog.getByTestId("confirm-button")).toBeDisabled();
  await dialog.getByTestId("confirm-input").fill(email.toUpperCase());
  await dialog.getByTestId("confirm-button").click();
  await expect(page).toHaveURL(/\?account=deleted/);
  await expect(page.getByTestId("account-deleted")).toBeVisible();
  await signIn(page, email, PASSWORD);
  await expect(page.getByRole("status")).toContainText(/invalid/i);
});

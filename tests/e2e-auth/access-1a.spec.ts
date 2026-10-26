import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createCompany, newEmail, PASSWORD, requireLocalStack, signIn, signOut, signUp } from "./helpers";

requireLocalStack();

/** The 6-digit code an authenticator app shows for a base32 key (RFC 6238, 30-second steps). */
function totp(secret: string, at = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, "0");
}

async function invite(owner: Page, email: string, role: "editor" | "viewer") {
  await owner.goto("/admin/people");
  await owner.getByPlaceholder("colleague@firm.com").fill(email);
  await owner.locator("select").first().selectOption(role);
  await owner.getByRole("button", { name: "Invite a person" }).click();
  await expect(owner.getByRole("cell", { name: email })).toBeVisible();
}

test("invitations wait for an answer, show their expiry, and every people change is on the record", async ({ browser }) => {
  const owner = await (await browser.newContext()).newPage();
  await signUp(owner, { name: "Ola Owner", org: "Invite Advisory", email: newEmail("inv-owner") });
  const yes = newEmail("inv-yes"), no = newEmail("inv-no");
  await invite(owner, yes, "editor");
  await invite(owner, no, "viewer");
  await expect(owner.getByTestId("invite-state").first()).toContainText("expires");

  const declines = await (await browser.newContext()).newPage();
  await signUp(declines, { name: "Nadia No", org: "No Firm", email: no });
  await declines.getByTestId("invite-decline").click();
  await expect(declines.getByTestId("pending-invite")).toHaveCount(0);

  const accepts = await (await browser.newContext()).newPage();
  await signUp(accepts, { name: "Yara Yes", org: "Yes Firm", email: yes });
  await expect(accepts.getByTestId("pending-invite")).toContainText("Ola Owner invited you to Invite Advisory as an editor.");
  await accepts.getByTestId("invite-accept").click();
  await expect(accepts.getByRole("status")).toContainText("You joined Invite Advisory.");

  await owner.goto("/admin/people");
  await expect(owner.getByTestId("owner-badge")).toHaveCount(1);
  await expect(owner.getByTestId("invite-row").filter({ hasText: no })).toContainText("declined");
  await owner.goto("/admin/audit");
  const audit = owner.getByTestId("org-audit");
  for (const t of ["Invitation sent", "Invitation declined", "Invitation accepted", "Member added"]) await expect(audit).toContainText(t);
});

test("two-step sign-in: an admin turns it on, signs in with the code, and confirms with password and code before deleting; the company comes back", async ({ page }) => {
  test.slow();
  const email = newEmail("mfa");
  await signUp(page, { name: "Maha Mfa", org: "Mfa Advisory", email });
  await expect(page.getByTestId("mfa-banner")).toContainText("Admins need two-step sign-in");
  const id = await createCompany(page, "Mfa Co");

  await page.goto("/account");
  await page.getByTestId("mfa-start").click();
  const secret = (await page.getByTestId("mfa-secret").textContent())!.trim();
  await page.getByTestId("mfa-confirm-code").fill(totp(secret));
  await page.getByTestId("mfa-confirm").click();
  await expect(page.getByTestId("mfa-status")).toContainText("On:");
  await page.goto("/companies");
  await expect(page.getByTestId("mfa-banner")).toHaveCount(0);

  // The next sign-in asks for the code after the password.
  await signOut(page);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).last().click();
  await page.getByTestId("mfa-code").fill("000000");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("status")).toContainText("That code is not right");
  // A password-only session cannot open the app's pages: they send it back to the code.
  await page.goto("/companies");
  await expect(page).toHaveURL(/\/login\?.*mfa=1/);
  await page.getByTestId("mfa-code").fill(totp(secret));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/companies/);

  // Deleting asks for the password and the code; a wrong password stops it.
  await page.goto(`/company/${id}/settings/profile`);
  await page.getByRole("button", { name: "Delete this company" }).click();
  const del = page.getByTestId("delete-company-dialog");
  await del.getByTestId("confirm-input").fill("Mfa Co");
  await del.getByTestId("reauth-password").fill("not-the-password-1");
  await del.getByTestId("reauth-code").fill(totp(secret));
  await del.getByTestId("confirm-button").click();
  await expect(del.getByRole("alert")).toContainText("That password is not right.");
  await del.getByTestId("reauth-password").fill(PASSWORD);
  await del.getByTestId("reauth-code").fill(totp(secret));
  await del.getByTestId("confirm-button").click();
  await page.waitForURL(/\/companies/);
  await expect(page.getByText("Mfa Co")).toHaveCount(0);

  // Recently deleted brings it back.
  await page.goto("/admin/organisation");
  await expect(page.getByTestId("deleted-item")).toContainText("Mfa Co");
  await page.getByTestId("restore").click();
  await expect(page.getByRole("status")).toContainText("Mfa Co is back.");
  await page.goto("/companies");
  await expect(page.getByText("Mfa Co")).toBeVisible();
});

test("after 30 minutes without activity people are warned, then signed out; a long-closed tab finds its session ended", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const email = newEmail("idle");
  await signUp(page, { name: "Ines Idle", org: "Idle Advisory", email });
  // The limit shortened to 12 seconds for the test (warned 6 seconds before).
  await page.addInitScript(() => { (globalThis as { __irIdleMs?: number }).__irIdleMs = 12_000; });
  await page.goto("/companies");
  await expect(page.getByTestId("idle-warning")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("stay-signed-in").click();
  await expect(page.getByTestId("idle-warning")).toHaveCount(0);
  await page.waitForURL(/\/login\?reason=idle/, { timeout: 30_000 });
  await expect(page.getByRole("status")).toContainText("signed out after 30 minutes");

  // The server's own check: a last-seen stamp over 30 minutes old ends the session on the next visit. A stamp left from
  // an earlier session is cleared while signed out, so it never ends the next sign-in.
  const back = await (await browser.newContext()).newPage();
  await back.goto("/login");
  await back.context().addCookies([{ name: "ir_seen", value: String(Date.now() - 31 * 60_000), url: back.url() }]);
  await signIn(back, email);
  await expect(back).toHaveURL(/\/companies/);
  // An active page tells the server it is still in use.
  expect((await back.request.get("/api/seen")).status()).toBe(204);
  // Leave the app first: an open page's own requests (link prefetches) would refresh the stamp straight away.
  const site = back.url();
  await back.goto("about:blank");
  await back.context().addCookies([{ name: "ir_seen", value: String(Date.now() - 31 * 60_000), url: site }]);
  await back.goto("/companies");
  await expect(back).toHaveURL(/\/login\?.*reason=idle/);
});

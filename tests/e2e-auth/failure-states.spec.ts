import { execFileSync } from "node:child_process";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { createCompany, localEnv, newEmail, PASSWORD, requireLocalStack, signUp } from "./helpers";

requireLocalStack();

// A database that fails or is still adding up must never show as "no sales" or an upload prompt (local stack only: the
// failures are injected into the local database for one company at a time, so parallel tests are unaffected).
const DB = localEnv("LOCAL_DB_URL") || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-Atq", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" }).trim();

/** Two months of sales lines for the company, then the background worker's turn (as if the upload had settled). */
function seedSales(company: string) {
  sql(`with b as (insert into public.sales_batches (company_id, source, filename) values ('${company}', 'file', 'Invoices.xlsx') returning id)
       insert into public.sales_lines (company_id, batch_id, source, period, day, doc, customer, product, amount, qty)
       select '${company}', b.id, 'file', p, (p || '-10')::date, 'INV/' || p, 'North Clinic', 'Pump', 1000, 1 from b, unnest(array['2026-08','2026-09']) p`);
}
const settle = (company: string) => sql(`update private.summary_marks set marked_at = now() - interval '1 minute' where company_id = '${company}'; select private.refresh_summary_rollups(1000)`);

/** A summary function times out (57014) for this company only; returns the undo. */
function breakSummaries(company: string, fn = "public.summary_state(uuid,text,bigint)") {
  const original = sql(`select pg_get_functiondef('${fn}'::regprocedure)`);
  const broken = original.replace(/\bbegin\b/i, `begin\n  if p_company = '${company}' then raise exception 'canceling statement due to statement timeout' using errcode = '57014'; end if;`);
  sql(broken);
  return () => sql(original);
}

test("a summary that times out shows as failed with a retry, never as no sales; Try again recovers", async ({ page }) => {
  await signUp(page, { name: "Fay Fail", org: "Fail Firm", email: newEmail("fail") });
  const id = await createCompany(page, "Timeout Trading");
  seedSales(id);
  settle(id);
  const restore = breakSummaries(id);
  try {
    await page.goto(`/company/${id}/sales`);
    await expect(page.getByTestId("module-failed")).toBeVisible();
    await expect(page.getByTestId("module-failed")).toContainText("couldn't be loaded");
    await expect(page.getByTestId("no-sales")).toHaveCount(0);
    // The Data steps and readiness say "couldn't be checked", never "to do".
    await page.goto(`/company/${id}/data`);
    // (No General Ledger in this company, so the sub-ledger steps are locked behind it; with one they read "unchecked".)
    await expect(page.getByTestId("step-sales")).toHaveAttribute("data-status", /unchecked|locked/);
    await expect(page.getByTestId("step-sales")).not.toHaveAttribute("data-status", /todo|done|verified/);
    await page.goto(`/company/${id}/data/readiness`);
    await expect(page.getByTestId("readiness-unread-sales")).toBeVisible();
    await page.goto(`/company/${id}/sales`);
  } finally {
    restore();
  }
  await page.getByTestId("module-retry").click();
  await expect(page.getByTestId("module-failed")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId("no-sales")).toHaveCount(0);
});

test("figures read before a failure stay on screen, marked as not the latest with their time", async ({ page }) => {
  await signUp(page, { name: "Sid Stale", org: "Stale Firm", email: newEmail("stale") });
  const id = await createCompany(page, "Stale Trading");
  seedSales(id);
  settle(id);
  await page.goto(`/company/${id}/sales`);
  await expect(page.getByTestId("module-failed")).toHaveCount(0);
  await expect(page.getByTestId("no-sales")).toHaveCount(0);
  const restore = breakSummaries(id);
  try {
    await page.reload();
    await expect(page.getByTestId("module-stale")).toBeVisible();
    await expect(page.getByTestId("no-sales")).toHaveCount(0);
  } finally {
    restore();
  }
});

test("right after an upload the figures are added up live; if that can't run either, the page waits instead of showing no sales", async ({ page }) => {
  await signUp(page, { name: "Pam Pend", org: "Pend Firm", email: newEmail("pend") });
  const id = await createCompany(page, "Pending Trading");
  seedSales(id);
  // Still settling: the worker leaves it alone, so the page adds the figures up live.
  sql(`update private.summary_marks set marked_at = now() + interval '1 hour' where company_id = '${id}'`);
  await page.goto(`/company/${id}/sales`);
  await expect(page.getByTestId("module-pending")).toHaveCount(0);
  await expect(page.getByTestId("no-sales")).toHaveCount(0);
  // The live calculation times out too: the page waits (and refreshes by itself) instead.
  const restore = breakSummaries(id, "public.sales_summary(uuid)");
  try {
    await page.reload();
    await expect(page.getByTestId("module-pending")).toBeVisible();
    await expect(page.getByTestId("no-sales")).toHaveCount(0);
  } finally {
    restore();
  }
  settle(id);
  // The page refreshes by itself (every 5 s) and shows the figures.
  await expect(page.getByTestId("module-pending")).toHaveCount(0, { timeout: 20_000 });
});

// ---- Viewers: refused by the server and the database, not only by hidden buttons.
const URL = localEnv("NEXT_PUBLIC_SUPABASE_URL");
const KEY = localEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
async function apiUser(api: APIRequestContext, tag: string) {
  const email = newEmail(tag);
  const r = await api.post(`${URL}/auth/v1/signup`, { headers: { apikey: KEY }, data: { email, password: PASSWORD, data: { full_name: tag, org_name: `${tag} org` } } });
  expect(r.ok(), await r.text()).toBe(true);
  const j = await r.json();
  return { email, id: j.user.id as string, h: { apikey: KEY, Authorization: `Bearer ${j.access_token}`, "content-type": "application/json", Prefer: "return=representation" } };
}

test("a viewer cannot clear data, change settings or write commentary, even by calling the server directly", async ({ request: api, browser }) => {
  const owner = await apiUser(api, "vowner");
  const [org] = await (await api.get(`${URL}/rest/v1/organizations?select=id`, { headers: owner.h })).json();
  const company = (await (await api.post(`${URL}/rest/v1/companies`, { headers: owner.h, data: { org_id: org.id, name: "Viewer Guarded Co" } })).json())[0].id as string;
  sql(`insert into public.sales_batches (company_id, source, filename) values ('${company}', 'file', 'x.xlsx')`);
  const viewer = await apiUser(api, "vviewer");
  // (Members join through invites in the app; the test adds the viewer directly.)
  sql(`insert into public.memberships (org_id, user_id, role) values ('${org.id}', '${viewer.id}', 'viewer')`);

  // The database refuses the viewer's writes.
  const clear = await api.post(`${URL}/rest/v1/rpc/clear_company_data`, { headers: viewer.h, data: { p_company: company, p_scope: "sales", p_confirm: 0 } });
  expect(clear.ok()).toBe(false);
  expect(await (await api.patch(`${URL}/rest/v1/companies?id=eq.${company}`, { headers: viewer.h, data: { name: "changed" } })).json()).toEqual([]);
  expect(await (await api.delete(`${URL}/rest/v1/sales_batches?company_id=eq.${company}`, { headers: viewer.h })).json()).toEqual([]);
  expect(sql(`select count(*) from public.sales_batches where company_id = '${company}'`)).toBe("1");
  // The viewer can read the kept summaries; a stranger cannot.
  expect((await api.post(`${URL}/rest/v1/rpc/summary_state`, { headers: viewer.h, data: { p_company: company, p_kind: "sales" } })).ok()).toBe(true);
  const stranger = await apiUser(api, "vstranger");
  expect((await api.post(`${URL}/rest/v1/rpc/summary_state`, { headers: stranger.h, data: { p_company: company, p_kind: "sales" } })).status()).toBe(403);

  // The app's own server refuses too (signed in as the viewer in a browser).
  const page = await (await browser.newContext()).newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(viewer.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).last().click();
  await expect(page).toHaveURL(/\/companies/);
  const ai = await page.request.post(`/api/companies/${company}/commentary`, { data: { type: "month", end: "2026-09", sections: ["summary"] } });
  expect(ai.status()).toBe(403);
  await page.goto(`/company/${company}/reports`);
  await expect(page.getByTestId("report-blocked")).toContainText("View-only");
  await expect(page.getByTestId("create-report")).toHaveCount(0);
  expect(sql(`select name from public.companies where id = '${company}'`)).toBe("Viewer Guarded Co");
});

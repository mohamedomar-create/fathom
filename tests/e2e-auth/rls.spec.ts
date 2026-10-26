import { expect, test, type APIRequestContext } from "@playwright/test";
import { localEnv, newEmail, PASSWORD, requireLocalStack } from "./helpers";

requireLocalStack();

// Straight to the database API, as an attacker with their own valid sign-in would: row level security must hold without the app.
const URL = localEnv("NEXT_PUBLIC_SUPABASE_URL");
const KEY = localEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

async function user(api: APIRequestContext, tag: string) {
  const r = await api.post(`${URL}/auth/v1/signup`, { headers: { apikey: KEY }, data: { email: newEmail(tag), password: PASSWORD, data: { full_name: tag, org_name: `${tag} org` } } });
  expect(r.ok(), await r.text()).toBe(true);
  const token = (await r.json()).access_token as string;
  const h = { apikey: KEY, Authorization: `Bearer ${token}`, "content-type": "application/json", Prefer: "return=representation" };
  const get = async (path: string) => api.get(`${URL}/rest/v1/${path}`, { headers: h });
  return { h, get, rows: async (path: string) => (await (await get(path)).json()) as Record<string, unknown>[] };
}

test("a stranger's token reads and changes nothing in another organisation", async ({ request: api }) => {
  const a = await user(api, "alice");
  const [org] = await a.rows("organizations?select=id");
  const made = await api.post(`${URL}/rest/v1/companies`, { headers: a.h, data: { org_id: org.id, name: "Alice Secret Co" } });
  expect(made.status()).toBe(201);
  const company = (await made.json())[0].id as string;
  await api.post(`${URL}/rest/v1/commentary`, { headers: a.h, data: { company_id: company, period_key: "month:2026-09", section: "summary", body: "private" } });
  expect((await a.rows(`companies?id=eq.${company}&select=id`)).length).toBe(1);

  const b = await user(api, "bob");
  for (const t of ["organizations", "companies", "source_accounts", "account_balances", "imports", "odoo_connections", "commentary", "reports", "invites"]) {
    const col = ["organizations"].includes(t) ? `id=eq.${org.id}` : t === "companies" ? `id=eq.${company}` : t === "invites" ? `org_id=eq.${org.id}` : `company_id=eq.${company}`;
    // odoo_connections: every column but the encrypted key may be selected (migration 0025).
    expect(await b.rows(`${t}?${col}&select=${t === "odoo_connections" ? "company_id,url" : "*"}`), `${t} visible to a stranger`).toEqual([]);
  }
  expect((await b.rows(`memberships?org_id=eq.${org.id}&select=*`))).toEqual([]);

  // Writes are refused or touch nothing.
  const patch = await api.patch(`${URL}/rest/v1/companies?id=eq.${company}`, { headers: b.h, data: { name: "pwned" } });
  expect(await patch.json()).toEqual([]);
  // Companies are deleted only through delete_company (0039): a direct delete is refused for everyone.
  const del = await api.delete(`${URL}/rest/v1/companies?id=eq.${company}`, { headers: b.h });
  expect(del.ok()).toBe(false);
  expect((await del.json()).code).toBe("42501");
  expect((await api.post(`${URL}/rest/v1/memberships`, { headers: b.h, data: { org_id: org.id, user_id: (await b.rows("profiles?select=id"))[0].id, role: "admin" } })).ok()).toBe(false);
  expect((await api.post(`${URL}/rest/v1/commentary`, { headers: b.h, data: { company_id: company, period_key: "month:2026-09", section: "kpis", body: "x" } })).ok()).toBe(false);
  expect((await api.post(`${URL}/rest/v1/rpc/save_company_version`, { headers: b.h, data: { p_company: company, p_accounts: [] } })).ok()).toBe(false);
  expect((await api.post(`${URL}/rest/v1/rpc/delete_organisation`, { headers: b.h, data: { p_org: org.id, p_name: "alice org" } })).ok()).toBe(false);
  expect((await a.rows(`companies?id=eq.${company}&select=name`))[0].name).toBe("Alice Secret Co");

  // Visitors who are not signed in reach no table at all.
  const anon = await api.get(`${URL}/rest/v1/companies?select=id`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  expect(anon.status()).toBe(401);
  const pub = await api.post(`${URL}/rest/v1/rpc/get_published_report`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "content-type": "application/json" }, data: { p_token: "x".repeat(40) } });
  expect(await pub.json()).toBeNull();
});

test("the Odoo API key can't be read back through the database API, even by the company's admin", async ({ request: api }) => {
  const a = await user(api, "odooadmin");
  const [org] = await a.rows("organizations?select=id");
  const company = (await (await api.post(`${URL}/rest/v1/companies`, { headers: a.h, data: { org_id: org.id, name: "Odoo Keyed Co" } })).json())[0].id as string;
  // No direct writes: a connection is saved only through odoo_save, by an admin, with a key the app encrypted.
  expect((await api.post(`${URL}/rest/v1/odoo_connections`, { headers: a.h, data: { company_id: company, url: "https://evil.example", db: "x", login: "me@x", api_key_enc: "v2.a.b.c" } })).ok()).toBe(false);
  const saved = await api.post(`${URL}/rest/v1/rpc/odoo_save`, { headers: a.h, data: { p_company: company, p_url: "https://x.odoo.com", p_db: "x", p_login: "me@x", p_key_enc: "v2.secret.t.c", p_odoo_company_id: 1, p_odoo_company_name: "X", p_include_branches: false, p_months: 25, p_version: "18.0", p_key_expires_on: null } });
  expect(saved.ok(), await saved.text()).toBe(true);
  expect((await a.get(`odoo_connections?company_id=eq.${company}&select=api_key_enc`)).ok()).toBe(false);
  expect((await a.get(`odoo_connections?company_id=eq.${company}&select=*`)).ok()).toBe(false);
  expect(await a.rows(`odoo_connections?company_id=eq.${company}&select=url,has_key`)).toEqual([{ url: "https://x.odoo.com", has_key: true }]);
  // The log records the save and cannot be written or erased through the API.
  expect((await a.rows(`odoo_audit?company_id=eq.${company}&select=action`)).map((r) => r.action)).toEqual(["save"]);
  expect((await api.post(`${URL}/rest/v1/odoo_audit`, { headers: a.h, data: { company_id: company, action: "sync", ok: true } })).ok()).toBe(false);
  await api.delete(`${URL}/rest/v1/odoo_audit?company_id=eq.${company}`, { headers: a.h });
  expect((await a.rows(`odoo_audit?company_id=eq.${company}&select=action`)).length).toBe(1);
  // A stranger cannot ask for the key through the server-side function either.
  const b = await user(api, "odoostranger");
  expect((await api.post(`${URL}/rest/v1/rpc/odoo_secret`, { headers: b.h, data: { p_company: company } })).ok()).toBe(false);
});

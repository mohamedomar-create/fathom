import { expect, test, type APIRequestContext } from "@playwright/test";
import { newEmail, PASSWORD, requireLocalStack } from "./helpers";

requireLocalStack();

// Straight to the database API, as an attacker with their own valid sign-in would: row level security must hold without the app.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

async function user(api: APIRequestContext, tag: string) {
  const r = await api.post(`${URL}/auth/v1/signup`, { headers: { apikey: KEY }, data: { email: newEmail(tag), password: PASSWORD, data: { full_name: tag, org_name: `${tag} org` } } });
  expect(r.ok()).toBe(true);
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
    expect(await b.rows(`${t}?${col}&select=*`), `${t} visible to a stranger`).toEqual([]);
  }
  expect((await b.rows(`memberships?org_id=eq.${org.id}&select=*`))).toEqual([]);

  // Writes are refused or touch nothing.
  const patch = await api.patch(`${URL}/rest/v1/companies?id=eq.${company}`, { headers: b.h, data: { name: "pwned" } });
  expect(await patch.json()).toEqual([]);
  const del = await api.delete(`${URL}/rest/v1/companies?id=eq.${company}`, { headers: b.h });
  expect(await del.json()).toEqual([]);
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

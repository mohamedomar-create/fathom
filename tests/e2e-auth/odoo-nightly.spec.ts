// The nightly Odoo sync end to end on the local stack: the database hands out the job for the CRON_SECRET, the engine
// saves through odoo_cron_rpc (real argument types: jsonb, text[], dates) as the editor who turned it on, and the route
// answers only to the secret. Odoo is the fake one used by the unit tests.
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { OdooClient } from "@/lib/odoo/client";
import { runNightly, type NightlyCtx } from "@/lib/odoo/nightly";
import { fakeOdoo } from "../fixtures/fake-odoo";
import { localEnv, newEmail, requireLocalStack } from "./helpers";

const DB = localEnv("LOCAL_DB_URL") || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-qAt", "-v", "ON_ERROR_STOP=1", "-c", q]).toString().trim();
const SECRET = "nightly-test-".padEnd(64, "x");

test.describe("nightly Odoo sync (0046)", () => {
  requireLocalStack();

  test("the job saves balances, journal lines, sales and stock for its company as the editor, then finishes", async () => {
    const email = newEmail("nightly");
    sql(`insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at) values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${email}', '{"full_name":"Nia"}', now())`);
    const uid = sql(`select id from auth.users where email = '${email}'`);
    const co = sql(`insert into public.companies (org_id, name) select org_id, 'Nightly Co' from public.memberships where user_id = '${uid}' limit 1 returning id`);
    sql(`insert into public.odoo_connections (company_id, url, db, login, api_key_enc, odoo_company_id, odoo_company_name, months_history) values ('${co}', 'https://x.odoo.com', 'db', 'me@x.com', 'v2.a.b.c', 1, 'X', 25)`);
    sql(`select private.set_cron_secret('${SECRET}')`);
    sql(`insert into public.odoo_sync_jobs (company_id, nightly, requested_by, next_run_at) values ('${co}', true, '${uid}', now() - interval '1 minute')`);

    const anon = createClient(localEnv("NEXT_PUBLIC_SUPABASE_URL"), localEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), { auth: { persistSession: false } });
    const call = async (fn: string, args: Record<string, unknown>) => {
      const { data, error } = await (anon.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(fn, args);
      if (error) throw new Error(`${fn}: ${error.message}`);
      return data;
    };
    expect(await call("odoo_cron_next", { p_secret: "wrong".padEnd(40, "!") }).catch((e) => (e as Error).message)).toMatch(/not allowed/);
    // Other tests' companies may be due too: take jobs until ours comes out.
    let ctx: NightlyCtx | null = null;
    for (let i = 0; i < 20 && !ctx; i++) {
      const got = (await call("odoo_cron_next", { p_secret: SECRET })) as NightlyCtx | null;
      if (!got) break;
      if (got.company_id === co) ctx = got;
      else await call("odoo_cron_finish", { p_secret: SECRET, p_company: got.company_id, p_run: got.run, p_ok: false, p_detail: "skipped by test" });
    }
    expect(ctx?.company_id).toBe(co);

    const client = new OdooClient("https://x.odoo.com", "db", "me@x.com", "secret", fakeOdoo(18).fetch);
    const rpc = (fn: string, args: Record<string, unknown>) => call("odoo_cron_rpc", { p_secret: SECRET, p_company: co, p_run: ctx!.run, p_fn: fn, p_args: args });
    const out = await runNightly(rpc, ctx!, client, { part: "balances" }, Date.now() + 60_000);
    expect(out.error ?? null).toBeNull();
    expect(out.next).toBeNull();
    await call("odoo_cron_finish", { p_secret: SECRET, p_company: co, p_run: ctx!.run, p_ok: true, p_detail: out.detail, p_rows: out.rows, p_version: out.version });

    expect(Number(sql(`select data_version from public.companies where id = '${co}'`))).toBeGreaterThan(0);
    expect(Number(sql(`select count(*) from public.sales_lines where company_id = '${co}'`))).toBeGreaterThan(0);
    expect(Number(sql(`select count(*) from public.stock_onhand where company_id = '${co}'`))).toBeGreaterThan(0);
    expect(sql(`select (created_by = '${uid}')::text from public.imports where company_id = '${co}' order by created_at desc limit 1`)).toBe("true");
    expect(sql(`select concat(status, ' ', last_ok) from public.odoo_sync_jobs where company_id = '${co}'`)).toBe("idle t");
    expect(sql(`select concat(c.status, ' ', co.source) from public.odoo_connections c join public.companies co on co.id = c.company_id where c.company_id = '${co}'`)).toBe("ok odoo");
  });

  test("the cron route answers only to the secret", async ({ request }) => {
    expect((await request.get("/api/cron/odoo")).status()).toBe(404);
    expect((await request.get("/api/cron/odoo", { headers: { authorization: "Bearer not-the-secret-not-the-secret-not" } })).status()).toBe(404);
    expect((await request.post("/api/cron/odoo", { data: { hop: 0 } })).status()).toBe(404);
  });
});

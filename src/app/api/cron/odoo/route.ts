import { after, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/env";
import { connect, openKey } from "@/lib/odoo/connect";
import { cronAuthorized, runNightly, type NightlyCtx, type NightStep } from "@/lib/odoo/nightly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Each call works this long, then hands the rest to a fresh call (a step already running is allowed to finish). */
const BUDGET_MS = 120_000;
/** A run never chains itself more than this many times. */
const MAX_HOPS = 300;

const Body = z.object({
  hop: z.number().int().min(0).max(MAX_HOPS),
  job: z.object({ ctx: z.record(z.string(), z.unknown()), step: z.record(z.string(), z.unknown()) }).optional(),
});
type Job = { ctx: NightlyCtx; step: NightStep };

/**
 * Nightly Odoo sync. Vercel calls it on the schedule in vercel.json with `Authorization: Bearer <CRON_SECRET>`; it answers
 * at once and works after the answer. It holds no key of its own: it reaches the database with the public key and the
 * CRON_SECRET, which the database checks (0046) before handing out a job or saving anything.
 */
export async function GET(req: Request) {
  if (!cronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const origin = new URL(req.url).origin;
  after(() => work(origin, 0, null));
  return NextResponse.json({ ok: true }, { status: 202 });
}

export async function POST(req: Request) {
  if (!cronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const origin = new URL(req.url).origin;
  after(() => work(origin, body.data.hop, (body.data.job as unknown as Job | undefined) ?? null));
  return NextResponse.json({ ok: true }, { status: 202 });
}

const log = (level: "info" | "error", msg: string, extra: Record<string, unknown> = {}) =>
  console[level](JSON.stringify({ level, context: "odoo_nightly", msg, ...extra }));

async function work(origin: string, hop: number, job: Job | null) {
  const secret = process.env.CRON_SECRET!;
  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const call = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await (db.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(fn, args);
    if (error) throw new Error(error.message);
    return data;
  };
  const finish = (company: string, run: string, ok: boolean, detail: string | null, rows?: number, version?: string) =>
    call("odoo_cron_finish", { p_secret: secret, p_company: company, p_run: run, p_ok: ok, p_detail: detail, p_rows: rows ?? null, p_version: version ?? null })
      .catch((e) => log("error", "finish failed", { company, error: (e as Error).message }));
  const deadline = Date.now() + BUDGET_MS;
  let cur = job;
  try {
    while (Date.now() < deadline) {
      if (!cur) {
        const ctx = (await call("odoo_cron_next", { p_secret: secret })) as NightlyCtx | null;
        if (!ctx) return;
        cur = { ctx, step: { part: "balances" } };
      }
      const { ctx } = cur;
      const c = ctx.connection;
      let client;
      try {
        ({ client } = await connect(c.url, c.db, c.login, openKey(c.api_key_enc, ctx.company_id, c.url, c.db, c.login), deadline + 120_000));
      } catch (e) {
        await finish(ctx.company_id, ctx.run, false, (e as Error).message.slice(0, 400));
        cur = null;
        continue;
      }
      const rpc = (fn: string, args: Record<string, unknown>) => call("odoo_cron_rpc", { p_secret: secret, p_company: ctx.company_id, p_run: ctx.run, p_fn: fn, p_args: args });
      const out = await runNightly(rpc, ctx, client, cur.step, deadline);
      if (!out.ok) {
        await finish(ctx.company_id, ctx.run, false, out.error ?? "The nightly sync failed.", out.rows);
        cur = null;
        continue;
      }
      if (out.next) { cur = { ctx, step: out.next }; break; }
      await finish(ctx.company_id, ctx.run, true, out.detail ?? "synced", out.rows, out.version);
      log("info", "company synced", { company: ctx.company_id, rows: out.rows });
      cur = null;
    }
  } catch (e) {
    log("error", "run stopped", { error: (e as Error).message });
    if (cur) await finish(cur.ctx.company_id, cur.ctx.run, false, `The nightly sync stopped: ${(e as Error).message}`.slice(0, 400));
    return;
  }
  // Time is up: carry on in a fresh call, with the company in progress (or to look for the next one).
  // If the hand-on fails, the company in progress is closed as failed (never left running until the next night).
  const giveUp = async (why: string) => { log("error", why); if (cur) await finish(cur.ctx.company_id, cur.ctx.run, false, `The nightly sync stopped part-way: ${why}`); };
  if (hop + 1 > MAX_HOPS) { await giveUp("too many hand-ons; the rest waits for the next night"); return; }
  try {
    const r = await fetch(`${origin}/api/cron/odoo`, {
      method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ hop: hop + 1, ...(cur ? { job: cur } : {}) }),
    });
    if (!r.ok) await giveUp(`the next step could not start (HTTP ${r.status})`);
  } catch (e) {
    await giveUp(`the next step could not start (${(e as Error).message})`);
  }
}

import "server-only";
import type { getUser } from "@/lib/supabase/server";

type Supa = Awaited<ReturnType<typeof getUser>>["supabase"];

/**
 * The named limits. Their window and maximum live in the database (private.rate_scopes, migration 0016), so a caller
 * cannot choose them; the copy here is used only while a database without 0016 still runs the older function.
 */
export const SCOPES = {
  invite: [86400, 30], pdf_read_company: [86400, 200], pdf_read_user: [86400, 400], ai_company: [86400, 20], ai_user: [86400, 60],
  pdf_render_user: [3600, 30], pdf_render_ip: [600, 5], pdf_render_token: [3600, 20], export: [3600, 20],
  odoo: [3600, 20], odoo_test_company: [3600, 10], odoo_sync_company: [3600, 6], import: [3600, 60], inventory: [3600, 60], expenses: [3600, 60], sales: [3600, 60],
} as const satisfies Record<string, readonly [number, number]>;
export type Scope = keyof typeof SCOPES;

/** The database has no rate_limit_hit yet (0016 not applied). */
const missingFn = (e: { code?: string; message?: string }) => e.code === "PGRST202" || e.code === "42883" || /rate_limit_hit/.test(e.message ?? "") && /not find|does not exist/.test(e.message ?? "");

/**
 * Shared rate limit, counted in the database so it holds across server instances. The subject is the user, company or
 * organisation id the scope names (the database checks the caller may count it), or an address or link for signed-out use.
 * Returns true when the caller is over the limit. Fails open by default (a database problem is logged, never shown as a
 * block); failClosed treats a failed check as over the limit, for actions that reach outside systems (Odoo).
 */
export async function limited(supabase: Supa, scope: Scope, subject: string, failClosed = false): Promise<boolean> {
  const sub = subject.slice(0, 80) || "unknown";
  try {
    const { data, error } = await supabase.rpc("rate_limit_hit", { p_scope: scope, p_subject: sub });
    if (!error) return data === false;
    if (!missingFn(error)) { console.error("rate limit check failed", { scope, error: error.message }); return failClosed; }
    const [win, max] = SCOPES[scope];
    const old = await supabase.rpc("hit_rate_limit", { p_key: `${scope}:${sub}`, p_window_s: win, p_max: max });
    if (old.error) { console.error("rate limit check failed", { scope, error: old.error.message }); return failClosed; }
    return old.data === false;
  } catch (e) {
    console.error("rate limit check failed", { scope, error: (e as Error).message });
    return failClosed;
  }
}

/** The caller's IP as Vercel reports it (first hop of x-forwarded-for). */
export const clientIp = (req: Request) => req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

export const TOO_MANY = "Too many requests. Please wait a few minutes and try again.";

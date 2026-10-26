import "server-only";
import type { getUser } from "@/lib/supabase/server";

type Supa = Awaited<ReturnType<typeof getUser>>["supabase"];

/**
 * The named limits. Their window and maximum live in the database (private.rate_scopes); a caller cannot choose them.
 */
export type Scope =
  | "invite" | "pdf_read_company" | "pdf_read_user" | "ai_company" | "ai_user" | "pdf_render_user" | "pdf_render_ip" | "pdf_render_token" | "export"
  | "odoo" | "odoo_test_company" | "odoo_sync_company" | "import" | "import_preview" | "inventory" | "expenses" | "sales" | "payments" | "reset" | "cash_entry";

/**
 * Shared rate limit, counted in the database so it holds across server instances. The subject is the user, company or
 * organisation id the scope names (the database checks the caller may count it), or an address or link for signed-out use.
 * Returns true when the caller is over the limit. A check that cannot be made counts as over the limit (the person is
 * asked to try again in a minute) and is logged: a database problem never opens the door.
 */
export async function limited(supabase: Supa, scope: Scope, subject: string, failClosed = true): Promise<boolean> {
  const sub = subject.slice(0, 80) || "unknown";
  try {
    const { data, error } = await supabase.rpc("rate_limit_hit", { p_scope: scope, p_subject: sub });
    if (!error) return data === false;
    console.error("rate limit check failed", { scope, code: error.code, error: error.message });
    return failClosed;
  } catch (e) {
    console.error("rate limit check failed", { scope, error: (e as Error).message });
    return failClosed;
  }
}

/** The caller's IP as Vercel reports it (first hop of x-forwarded-for). */
export const clientIp = (req: Request) => req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

export const TOO_MANY = "Too many requests. Please wait a few minutes and try again.";

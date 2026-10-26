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
 * "error" when the check could not be made (logged): callers treat it as a refusal and say "try again in a minute".
 */
export async function checkLimit(supabase: Supa, scope: Scope, subject: string): Promise<"ok" | "over" | "error"> {
  const sub = subject.slice(0, 80) || "unknown";
  try {
    const { data, error } = await supabase.rpc("rate_limit_hit", { p_scope: scope, p_subject: sub });
    if (!error) return data === false ? "over" : "ok";
    console.error("rate limit check failed", { scope, code: error.code, error: error.message });
  } catch (e) {
    console.error("rate limit check failed", { scope, error: (e as Error).message });
  }
  return "error";
}

/** Several limits in turn: the first that is over (or could not be checked) decides. */
export async function limits(supabase: Supa, checks: [Scope, string][]): Promise<"ok" | "over" | "error"> {
  for (const [scope, subject] of checks) {
    const r = await checkLimit(supabase, scope, subject);
    if (r !== "ok") return r;
  }
  return "ok";
}

/** True when the caller is over the limit; a check that cannot be made counts as over (a database problem never opens the door). */
export async function limited(supabase: Supa, scope: Scope, subject: string, failClosed = true): Promise<boolean> {
  const r = await checkLimit(supabase, scope, subject);
  return r === "over" || (r === "error" && failClosed);
}

/** The caller's IP as Vercel reports it (first hop of x-forwarded-for). */
export const clientIp = (req: Request) => req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

export const TOO_MANY = "Too many requests. Please wait a few minutes and try again.";
export const BUSY = "The service is busy just now. Please try again in a minute.";

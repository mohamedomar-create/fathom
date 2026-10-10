import "server-only";
import type { getUser } from "@/lib/supabase/server";

type Supa = Awaited<ReturnType<typeof getUser>>["supabase"];

/**
 * Shared rate limit, counted in the database so it holds across server instances.
 * Returns true when the caller is over the limit. Fails open: a database problem is logged, never shown as a block.
 */
export async function limited(supabase: Supa, key: string, windowSeconds: number, max: number): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("hit_rate_limit", { p_key: key.slice(0, 120), p_window_s: windowSeconds, p_max: max });
    if (error) { console.error("rate limit check failed", { key, error: error.message }); return false; }
    return data === false;
  } catch (e) {
    console.error("rate limit check failed", { key, error: (e as Error).message });
    return false;
  }
}

/** The caller's IP as Vercel reports it (first hop of x-forwarded-for). */
export const clientIp = (req: Request) => req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

export const TOO_MANY = "Too many requests. Please wait a few minutes and try again.";

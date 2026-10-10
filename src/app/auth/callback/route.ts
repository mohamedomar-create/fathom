import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-redirect";

const OTP_TYPES = new Set<EmailOtpType>(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

/** Handles both PKCE links (?code=) and token-hash links (?token_hash=&type=), which work across browsers and devices. */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(url.searchParams.get("next"), type === "recovery" ? "/auth/reset" : "/companies");
  const supabase = await createClient();
  let ok = false;
  if (code) ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  else if (tokenHash && type && OTP_TYPES.has(type)) ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  if (ok) {
    await supabase.rpc("accept_pending_invites");
    return NextResponse.redirect(new URL(next, url.origin));
  }
  // The email may already be confirmed (e.g. link opened in another browser): let the user sign in.
  return NextResponse.redirect(new URL("/login?error=link", url.origin));
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { codeStillNeeded } from "./levels";

/** The person's confirmed authenticator-app factor, if any. */
export async function totpFactor(supabase: SupabaseClient): Promise<{ id: string } | null> {
  const { data } = await supabase.auth.mfa.listFactors();
  const f = data?.totp?.find((x) => x.status === "verified");
  return f ? { id: f.id } : null;
}

/** True when the session still needs the code (a factor is set up but this session signed in with the password only). */
export async function needsCode(supabase: SupabaseClient): Promise<boolean> {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return codeStillNeeded(data);
}

/** Checks a 6-digit code against the person's factor; the session becomes a two-step one. Returns an error, or null. */
export async function verifyCode(supabase: SupabaseClient, code: string): Promise<string | null> {
  const f = await totpFactor(supabase);
  if (!f) return "no_factor";
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: f.id, code: code.replace(/\s/g, "") });
  return error ? "wrong_code" : null;
}

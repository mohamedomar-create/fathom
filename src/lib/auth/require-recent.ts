import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { signedInRecently, type Claims } from "./recent";

export const REAUTH = "Please confirm your password and try again.";

/**
 * Destructive actions (deleting, clearing everything, moving a company, removing people) need a sign-in from the last
 * five minutes: the dialog asks for the password first. Returns the message to show, or null when it is fresh.
 */
export async function requireRecentSignIn(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims as Claims | undefined;
  if (error || !claims || !signedInRecently(claims, Math.floor(Date.now() / 1000))) return REAUTH;
  return null;
}

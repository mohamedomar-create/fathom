"use server";
import { MIN_PASSWORD } from "@/lib/password";
import { revalidatePath } from "next/cache";
import { requireRecentSignIn } from "@/lib/auth/require-recent";
import { redirect } from "next/navigation";
import { z } from "zod";
import { dbError } from "@/lib/action-error";
import { getUser } from "@/lib/supabase/server";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/env";
import { limited } from "@/lib/rate-limit";
import { changePasswordWith } from "@/lib/auth/password-change";

type Result = { ok: boolean; error?: string };
const SIGN_IN_AGAIN = "Please sign in again.";

export async function saveName(fullName: string): Promise<Result> {
  const v = z.string().trim().max(120, "Use 120 characters or fewer.").safeParse(fullName);
  if (!v.success) return { ok: false, error: v.error.issues[0]?.message };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: SIGN_IN_AGAIN };
  const { error } = await supabase.from("profiles").update({ full_name: v.data || null }).eq("id", user.id);
  if (error) return { ok: false, error: dbError(error, "saveName") };
  revalidatePath("/account");
  return { ok: true };
}

export async function leaveOrganisation(orgId: string): Promise<Result> {
  if (!z.string().uuid().safeParse(orgId).success) return { ok: false, error: "That value isn't valid." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: SIGN_IN_AGAIN };
  const { error } = await supabase.rpc("leave_organisation", { p_org: orgId });
  if (error) {
    // The last-admin trigger speaks in database terms; say what to do instead.
    if (/at least one admin/i.test(error.message)) return { ok: false, error: "You are this organisation's only admin. Make someone else an admin first (User management)." };
    return { ok: false, error: dbError(error, "leaveOrganisation") };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Deletes the signed-in user's account; on success the session is cleared and the user lands on the home page. */
export async function deleteAccount(typedEmail: string): Promise<Result> {
  const v = z.string().trim().email().max(254).safeParse(typedEmail);
  if (!v.success) return { ok: false, error: "Type your email address to confirm." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: SIGN_IN_AGAIN };
  { const stale = await requireRecentSignIn(supabase); if (stale) return { ok: false, error: stale }; }
  const { error } = await supabase.rpc("delete_my_account", { p_email: v.data });
  if (error) return { ok: false, error: dbError(error, "deleteAccount") };
  console.info(JSON.stringify({ level: "info", event: "account_deleted", user: user.id }));
  await supabase.auth.signOut().catch(() => undefined); // the user no longer exists; this only clears the cookies
  redirect("/?account=deleted");
}

/**
 * Changes the password after checking the current one (a stolen open session can't change it), then signs out every
 * other device. The current password is checked on a separate client, so this session and its two-step sign-in stay.
 */
export async function changePassword(current: string, next: string): Promise<Result> {
  const v = z.object({ current: z.string().max(200), next: z.string().max(200) }).safeParse({ current, next });
  if (!v.success) return { ok: false, error: `Use at least ${MIN_PASSWORD} characters.` };
  const { supabase, user } = await getUser();
  if (!user?.email) return { ok: false, error: SIGN_IN_AGAIN };
  const email = user.email;
  return changePasswordWith({
    limited: () => limited(supabase, "password", user.id),
    verify: async (e, password) => {
      const probe = createPlainClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      const { data, error } = await probe.auth.signInWithPassword({ email: e, password });
      if (error || !data.session) return false;
      await probe.auth.signOut({ scope: "local" }).catch(() => undefined);
      return true;
    },
    update: async (password) => (await supabase.auth.updateUser({ password })).error?.message ?? null,
    signOutOthers: async () => { await supabase.auth.signOut({ scope: "others" }); },
  }, email, v.data.current, v.data.next);
}

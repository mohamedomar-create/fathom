"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { dbError } from "@/lib/action-error";
import { getUser } from "@/lib/supabase/server";

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
  const { error } = await supabase.rpc("delete_my_account", { p_email: v.data });
  if (error) return { ok: false, error: dbError(error, "deleteAccount") };
  console.info(JSON.stringify({ level: "info", event: "account_deleted", user: user.id }));
  await supabase.auth.signOut().catch(() => undefined); // the user no longer exists; this only clears the cookies
  redirect("/?account=deleted");
}

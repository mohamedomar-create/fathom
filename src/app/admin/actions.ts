"use server";
import { revalidatePath } from "next/cache";
import { requireRecentSignIn } from "@/lib/auth/require-recent";
import { z } from "zod";
import { dbError } from "@/lib/action-error";
import { limited, TOO_MANY } from "@/lib/rate-limit";
import { getUser } from "@/lib/supabase/server";
import { orgFiles, removeFiles } from "@/lib/company/remove-files";

type Result = { ok: boolean; error?: string };
const Uuid = z.string().uuid();
const Role = z.enum(["admin", "editor", "viewer"]);
const NO_PERMISSION = "You do not have permission to change this.";

const OrgSchema = z.object({
  orgId: Uuid,
  name: z.string().trim().min(1).max(120),
  brand_colour: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable(),
  logo_url: z.string().url().max(500).refine((u) => u.startsWith("https://"), "Use an https:// address for the logo.").nullable().or(z.literal("").transform(() => null)),
  disclaimer: z.string().trim().min(1).max(1500),
  report_footer: z.string().max(200).nullable(),
});

async function signedIn() {
  const { supabase, user } = await getUser();
  return { supabase, user };
}

export async function saveOrg(input: z.input<typeof OrgSchema>): Promise<Result> {
  const v = OrgSchema.safeParse(input);
  if (!v.success) return { ok: false, error: v.error.issues[0]?.message };
  const { supabase, user } = await signedIn();
  if (!user) return { ok: false, error: "Please sign in again." };
  const { orgId, ...rest } = v.data;
  const { error, count } = await supabase.from("organizations").update(rest, { count: "exact" }).eq("id", orgId);
  if (error) return { ok: false, error: dbError(error, "saveOrg") };
  if (!count) return { ok: false, error: "Only admins can change organisation settings." };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function invite(orgId: string, email: string, role: "admin" | "editor" | "viewer"): Promise<Result> {
  const v = z.object({ orgId: Uuid, email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254), role: Role }).safeParse({ orgId, email, role });
  if (!v.success) return { ok: false, error: v.error.issues[0]?.message ?? "Enter a valid email address." };
  const { supabase, user } = await signedIn();
  if (!user) return { ok: false, error: "Please sign in again." };
  // Admins only, checked before the invite allowance is counted (the database refuses others too).
  const { data: me } = await supabase.from("memberships").select("role").eq("org_id", v.data.orgId).eq("user_id", user.id).maybeSingle();
  if (me?.role !== "admin") return { ok: false, error: "Only admins can invite people." };
  if (await limited(supabase, "invite", v.data.orgId)) return { ok: false, error: TOO_MANY };
  // A new invitation, or the same one sent again: open for another 14 days, waiting for an answer.
  const expires = new Date(Date.now() + 14 * 86_400_000).toISOString();
  const { error } = await supabase.from("invites").upsert({ org_id: v.data.orgId, email: v.data.email, role: v.data.role, invited_by: user.id, accepted_at: null, declined_at: null, expires_at: expires }, { onConflict: "org_id,email" });
  if (error) return { ok: false, error: dbError(error, "invite") };
  revalidatePath("/admin/people");
  return { ok: true };
}

/** The organisation must always keep an admin: refuse to demote or remove the last one (the database enforces it too). */
async function wouldLeaveNoAdmin(supabase: Awaited<ReturnType<typeof getUser>>["supabase"], orgId: string, userId: string) {
  const { data } = await supabase.from("memberships").select("user_id, role").eq("org_id", orgId).eq("role", "admin");
  const admins = data ?? [];
  return admins.length <= 1 && admins.some((a) => a.user_id === userId);
}

export async function setRole(orgId: string, userId: string, role: "admin" | "editor" | "viewer"): Promise<Result> {
  const v = z.object({ orgId: Uuid, userId: Uuid, role: Role }).safeParse({ orgId, userId, role });
  if (!v.success) return { ok: false, error: "That value isn't valid." };
  const { supabase, user } = await signedIn();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (v.data.role !== "admin" && (await wouldLeaveNoAdmin(supabase, v.data.orgId, v.data.userId))) return { ok: false, error: "An organisation needs at least one admin. Make someone else an admin first." };
  const { error, count } = await supabase.from("memberships").update({ role: v.data.role }, { count: "exact" }).eq("org_id", v.data.orgId).eq("user_id", v.data.userId);
  if (error) return { ok: false, error: dbError(error, "setRole") };
  if (!count) return { ok: false, error: NO_PERMISSION };
  revalidatePath("/admin/people");
  return { ok: true };
}

export async function removeMember(orgId: string, userId: string): Promise<Result> {
  const v = z.object({ orgId: Uuid, userId: Uuid }).safeParse({ orgId, userId });
  if (!v.success) return { ok: false, error: "That value isn't valid." };
  const { supabase, user } = await signedIn();
  if (!user) return { ok: false, error: "Please sign in again." };
  { const stale = await requireRecentSignIn(supabase); if (stale) return { ok: false, error: stale }; }
  if (await wouldLeaveNoAdmin(supabase, v.data.orgId, v.data.userId)) return { ok: false, error: "An organisation needs at least one admin. Make someone else an admin first." };
  const { error, count } = await supabase.from("memberships").delete({ count: "exact" }).eq("org_id", v.data.orgId).eq("user_id", v.data.userId);
  if (error) return { ok: false, error: dbError(error, "removeMember") };
  if (!count) return { ok: false, error: NO_PERMISSION };
  revalidatePath("/admin/people");
  return { ok: true };
}

export async function cancelInvite(id: string): Promise<Result> {
  if (!Uuid.safeParse(id).success) return { ok: false, error: "That value isn't valid." };
  const { supabase, user } = await signedIn();
  if (!user) return { ok: false, error: "Please sign in again." };
  const { error, count } = await supabase.from("invites").delete({ count: "exact" }).eq("id", id);
  if (error) return { ok: false, error: dbError(error, "cancelInvite") };
  if (!count) return { ok: false, error: NO_PERMISSION };
  revalidatePath("/admin/people");
  return { ok: true };
}

/** Deletes the organisation and everything in it. The database checks the caller is an admin and the typed name matches. */
export async function deleteOrganisation(orgId: string, typedName: string): Promise<Result> {
  const v = z.object({ orgId: Uuid, typedName: z.string().trim().min(1).max(120) }).safeParse({ orgId, typedName });
  if (!v.success) return { ok: false, error: "Type the organisation name to confirm." };
  const { supabase, user } = await signedIn();
  if (!user) return { ok: false, error: "Please sign in again." };
  { const stale = await requireRecentSignIn(supabase); if (stale) return { ok: false, error: stale }; }
  // The files are listed while the companies are still visible, the rows go first (all or nothing), then the files:
  // a refused delete never leaves companies whose files are already gone.
  const files = await orgFiles(supabase, v.data.orgId);
  const { error } = await supabase.rpc("delete_organisation", { p_org: v.data.orgId, p_name: v.data.typedName });
  if (error) return { ok: false, error: dbError(error, "deleteOrganisation") };
  const left = await removeFiles(supabase, files);
  if (left) console.error("delete organisation: stored files left", left);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** The owner hands the organisation to another admin (the owner alone deletes it and picks the next owner). */
export async function transferOwnership(orgId: string, userId: string): Promise<Result> {
  const v = z.object({ orgId: Uuid, userId: Uuid }).safeParse({ orgId, userId });
  if (!v.success) return { ok: false, error: "That value isn't valid." };
  const { supabase, user } = await signedIn();
  if (!user) return { ok: false, error: "Please sign in again." };
  { const stale = await requireRecentSignIn(supabase); if (stale) return { ok: false, error: stale }; }
  const { error } = await supabase.rpc("transfer_ownership", { p_org: v.data.orgId, p_user: v.data.userId });
  // Its own refusals ("Make them an admin first.") are already plain words.
  if (error) return { ok: false, error: !error.hint && (error.code === "22023" || error.code === "42501") ? error.message : dbError(error, "transferOwnership") };
  revalidatePath("/admin", "layout");
  return { ok: true };
}

/** The owner removes a member's two-step sign-in (a lost phone); they set it up again at their next sign-in. */
export async function resetMemberMfa(orgId: string, userId: string): Promise<Result> {
  const v = z.object({ orgId: Uuid, userId: Uuid }).safeParse({ orgId, userId });
  if (!v.success) return { ok: false, error: "That value isn't valid." };
  const { supabase, user } = await signedIn();
  if (!user) return { ok: false, error: "Please sign in again." };
  { const stale = await requireRecentSignIn(supabase); if (stale) return { ok: false, error: stale }; }
  const { error } = await supabase.rpc("reset_member_mfa", { p_org: v.data.orgId, p_user: v.data.userId });
  if (error) return { ok: false, error: dbError(error, "resetMemberMfa") };
  return { ok: true };
}

/** Brings back a company deleted in the last 14 days (admins of its organisation). */
export async function restoreCompany(companyId: string): Promise<Result> {
  if (!Uuid.safeParse(companyId).success) return { ok: false, error: "That value isn't valid." };
  const { supabase, user } = await signedIn();
  if (!user) return { ok: false, error: "Please sign in again." };
  const { error } = await supabase.rpc("restore_company", { p_company: companyId });
  if (error) return { ok: false, error: dbError(error, "restoreCompany") };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Brings back an organisation deleted in the last 14 days (its owner). */
export async function restoreOrganisation(orgId: string): Promise<Result> {
  if (!Uuid.safeParse(orgId).success) return { ok: false, error: "That value isn't valid." };
  const { supabase, user } = await signedIn();
  if (!user) return { ok: false, error: "Please sign in again." };
  const { error } = await supabase.rpc("restore_organisation", { p_org: orgId });
  if (error) return { ok: false, error: dbError(error, "restoreOrganisation") };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** The owner sets the organisation's monthly AI allowance (commentary and PDF reading), 0 to 200 dollars. */
export async function setAiAllowance(orgId: string, usd: string): Promise<Result> {
  // From the form as typed: an empty box is never read as 0 (which would stop AI for the organisation).
  const v = z.object({ orgId: Uuid, usd: z.string().trim().regex(/^\d{1,3}$/).transform(Number).pipe(z.number().max(200)) }).safeParse({ orgId, usd });
  if (!v.success) return { ok: false, error: "Enter a whole number of dollars from 0 to 200." };
  const { supabase, user } = await signedIn();
  if (!user) return { ok: false, error: "Please sign in again." };
  const { error, count } = await supabase.from("organizations").update({ ai_monthly_usd: v.data.usd }, { count: "exact" }).eq("id", v.data.orgId);
  if (error) return { ok: false, error: error.code === "42501" ? "Only the owner can change the AI allowance." : dbError(error, "setAiAllowance") };
  if (!count) return { ok: false, error: NO_PERMISSION };
  revalidatePath("/admin/organisation");
  return { ok: true };
}


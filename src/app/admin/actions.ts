"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dbError } from "@/lib/action-error";
import { limited, TOO_MANY } from "@/lib/rate-limit";
import { getUser } from "@/lib/supabase/server";

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
  if (await limited(supabase, `invite:${v.data.orgId}`, 86400, 30)) return { ok: false, error: TOO_MANY };
  const { error } = await supabase.from("invites").upsert({ org_id: v.data.orgId, email: v.data.email, role: v.data.role, invited_by: user.id, accepted_at: null }, { onConflict: "org_id,email" });
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

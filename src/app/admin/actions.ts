"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";

const OrgSchema = z.object({
  orgId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  brand_colour: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable(),
  logo_url: z.string().url().max(500).nullable().or(z.literal("").transform(() => null)),
  disclaimer: z.string().trim().min(1).max(1500),
  report_footer: z.string().max(200).nullable(),
});

export async function saveOrg(input: z.input<typeof OrgSchema>) {
  const v = OrgSchema.safeParse(input);
  if (!v.success) return { ok: false, error: v.error.issues[0]?.message };
  const { supabase } = await getUser();
  const { orgId, ...rest } = v.data;
  const { error, count } = await supabase.from("organizations").update(rest, { count: "exact" }).eq("id", orgId);
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "Only admins can change organisation settings." };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function invite(orgId: string, email: string, role: "admin" | "editor" | "viewer") {
  const e = z.string().email().safeParse(email.trim().toLowerCase());
  if (!e.success) return { ok: false, error: "Enter a valid email address." };
  const { supabase, user } = await getUser();
  const { error } = await supabase.from("invites").upsert({ org_id: orgId, email: e.data, role, invited_by: user?.id ?? null, accepted_at: null }, { onConflict: "org_id,email" });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/people");
  return { ok: true };
}

export async function setRole(orgId: string, userId: string, role: "admin" | "editor" | "viewer") {
  const { supabase } = await getUser();
  const { error } = await supabase.from("memberships").update({ role }).eq("org_id", orgId).eq("user_id", userId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/people");
  return { ok: true };
}

export async function removeMember(orgId: string, userId: string) {
  const { supabase } = await getUser();
  const { error } = await supabase.from("memberships").delete().eq("org_id", orgId).eq("user_id", userId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/people");
  return { ok: true };
}

export async function cancelInvite(id: string) {
  const { supabase } = await getUser();
  const { error } = await supabase.from("invites").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/people");
  return { ok: true };
}

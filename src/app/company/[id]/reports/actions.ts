"use server";
import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { DEFAULT_SECTIONS, REPORT_SECTIONS } from "@/lib/report/types";
import type { Json } from "@/lib/supabase/database.types";
import { dbError } from "@/lib/action-error";

const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Uuid = z.string().uuid();
const INVALID = { ok: false, error: "That value isn't valid." } as const;
const SIGN_IN = { ok: false, error: "Please sign in again." } as const;

export async function createReport(companyId: string, periodEnd: string) {
  const { supabase, user } = await getUser();
  if (!user) redirect("/login");
  const { data, error } = await supabase.from("reports").insert({
    company_id: Uuid.parse(companyId), period_end: Period.parse(periodEnd), period_type: "month", title: "Monthly Performance Report",
    sections: DEFAULT_SECTIONS as unknown as Json, created_by: user.id,
  }).select("id").single();
  if (error) throw new Error(dbError(error, "createReport"));
  redirect(`/company/${companyId}/reports/${data.id}`);
}

const SaveSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  period_type: z.enum(["month", "quarter", "year"]),
  period_end: Period,
  sections: z.array(z.object({ key: z.enum(REPORT_SECTIONS.map((s) => s.key) as [string, ...string[]]), enabled: z.boolean() })).max(30),
});

export async function saveReport(input: z.input<typeof SaveSchema>) {
  const v = SaveSchema.safeParse(input);
  if (!v.success) return { ok: false, error: v.error.issues[0]?.message };
  const { supabase, user } = await getUser();
  if (!user) return SIGN_IN;
  const { id, ...rest } = v.data;
  const { error, count } = await supabase.from("reports").update({ ...rest, sections: rest.sections as unknown as Json }, { count: "exact" }).eq("id", id);
  if (error) return { ok: false, error: dbError(error, "saveReport") };
  return count ? { ok: true } : { ok: false, error: "You do not have permission to change this." };
}

export async function saveCommentary(companyId: string, periodKey: string, section: string, body: string) {
  if (!Uuid.safeParse(companyId).success || !/^(month|quarter|year):\d{4}-\d{2}$/.test(periodKey) || !/^[a-z]{1,40}$/.test(section) || typeof body !== "string" || body.length > 6000) return { ok: false, error: "Invalid commentary" };
  const { supabase, user } = await getUser();
  if (!user) return SIGN_IN;
  if (body.trim() === "") {
    const { error } = await supabase.from("commentary").delete().eq("company_id", companyId).eq("period_key", periodKey).eq("section", section);
    return error ? { ok: false, error: dbError(error, "saveCommentary") } : { ok: true };
  }
  const { error } = await supabase.from("commentary").upsert({ company_id: companyId, period_key: periodKey, section, body, source: "user", updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: "company_id,period_key,section" });
  revalidatePath(`/company/${companyId}`, "layout");
  return error ? { ok: false, error: dbError(error, "saveCommentary") } : { ok: true };
}

/** Publish with a new secret link (optionally expiring after 30 or 90 days), or stop sharing: the old link stops working at once. */
export async function publishReport(id: string, publish: boolean, expiresDays: 0 | 30 | 90 = 0) {
  if (!Uuid.safeParse(id).success || ![0, 30, 90].includes(expiresDays)) return INVALID;
  const { supabase, user } = await getUser();
  if (!user) return SIGN_IN;
  const token = randomBytes(24).toString("base64url");
  const expires_at = publish && expiresDays ? new Date(Date.now() + expiresDays * 86400_000).toISOString() : null;
  const { data, error } = await supabase.from("reports").update(publish ? { status: "published", share_token: token, published_at: new Date().toISOString(), expires_at } : { status: "draft", share_token: null, expires_at: null }).eq("id", id).select("share_token, expires_at").maybeSingle();
  if (error) return { ok: false, error: dbError(error, "publishReport") };
  if (!data) return { ok: false, error: "You do not have permission to change this." };
  return { ok: true, token: data.share_token, expiresAt: data.expires_at };
}

export async function deleteReport(companyId: string, id: string) {
  if (!Uuid.safeParse(companyId).success || !Uuid.safeParse(id).success) return;
  const { supabase, user } = await getUser();
  if (!user) return;
  await supabase.from("reports").delete().eq("id", id).eq("company_id", companyId);
  revalidatePath(`/company/${companyId}/reports`);
}

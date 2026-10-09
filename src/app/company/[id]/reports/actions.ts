"use server";
import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { DEFAULT_SECTIONS, REPORT_SECTIONS } from "@/lib/report/types";
import type { Json } from "@/lib/supabase/database.types";

const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export async function createReport(companyId: string, periodEnd: string) {
  const { supabase, user } = await getUser();
  if (!user) redirect("/login");
  const { data, error } = await supabase.from("reports").insert({
    company_id: companyId, period_end: Period.parse(periodEnd), period_type: "month", title: "Monthly Performance Report",
    sections: DEFAULT_SECTIONS as unknown as Json, created_by: user.id,
  }).select("id").single();
  if (error) throw new Error(error.message);
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
  const { supabase } = await getUser();
  const { id, ...rest } = v.data;
  const { error, count } = await supabase.from("reports").update({ ...rest, sections: rest.sections as unknown as Json }, { count: "exact" }).eq("id", id);
  if (!error && !count) return { ok: false, error: "You do not have permission to change this." };
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function saveCommentary(companyId: string, periodKey: string, section: string, body: string) {
  if (!/^(month|quarter|year):\d{4}-\d{2}$/.test(periodKey) || !/^[a-z]+$/.test(section) || body.length > 6000) return { ok: false, error: "Invalid commentary" };
  const { supabase, user } = await getUser();
  if (body.trim() === "") {
    const { error } = await supabase.from("commentary").delete().eq("company_id", companyId).eq("period_key", periodKey).eq("section", section);
    return error ? { ok: false, error: error.message } : { ok: true };
  }
  const { error } = await supabase.from("commentary").upsert({ company_id: companyId, period_key: periodKey, section, body, source: "user", updated_by: user?.id ?? null, updated_at: new Date().toISOString() }, { onConflict: "company_id,period_key,section" });
  revalidatePath(`/company/${companyId}`, "layout");
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function publishReport(id: string, publish: boolean) {
  const { supabase } = await getUser();
  const token = randomBytes(24).toString("base64url");
  const { data, error } = await supabase.from("reports").update(publish ? { status: "published", share_token: token, published_at: new Date().toISOString() } : { status: "draft", share_token: null }).eq("id", id).select("share_token").single();
  return error ? { ok: false, error: error.message } : { ok: true, token: data.share_token };
}

export async function deleteReport(companyId: string, id: string) {
  const { supabase } = await getUser();
  await supabase.from("reports").delete().eq("id", id);
  revalidatePath(`/company/${companyId}/reports`);
}

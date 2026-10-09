"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ALL_CLASSES } from "@/lib/company/build";
import { saveCompanyData } from "@/lib/company/persist";
import { getUser } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

const ClassEnum = z.enum(ALL_CLASSES as [string, ...string[]]);
const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const ImportSchema = z.object({
  companyId: z.string().uuid(),
  filename: z.string().max(300).nullable(),
  accounts: z.array(z.object({
    code: z.string().max(40), name: z.string().min(1).max(300), cls: ClassEnum,
    amounts: z.record(Period, z.number().finite()),
    confidence: z.number().min(0).max(1).nullable().optional(),
    mapped_by: z.enum(["auto", "user", "system"]).optional(),
  })).min(1).max(5000),
  report: z.object({
    kind: z.string(), periods: z.array(Period), warnings: z.array(z.string()), notes: z.array(z.string()), flips: z.array(z.string()),
    mapping: z.record(z.string(), z.string()),
  }),
});

export async function commitImport(input: z.input<typeof ImportSchema>): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  const v = ImportSchema.safeParse(input);
  if (!v.success) return { ok: false, error: "The import data is not valid: " + v.error.issues[0]?.message };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  try {
    const version = await saveCompanyData(
      supabase, v.data.companyId,
      v.data.accounts.map((a) => ({ ...a, cls: a.cls as (typeof ALL_CLASSES)[number] })),
      { kind: "upload", filename: v.data.filename, report: v.data.report as unknown as Json },
      [...v.data.report.flips, ...v.data.report.notes],
    );
    await supabase.from("companies").update({ source: "upload" }).eq("id", v.data.companyId).neq("source", "odoo");
    revalidatePath(`/company/${v.data.companyId}`, "layout");
    return { ok: true, version };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ------------------------------------------------------------------ profile, KPIs, mapping
const ProfileSchema = z.object({
  companyId: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  currency: z.string().trim().min(1).max(6),
  fy_start_month: z.number().int().min(1).max(12),
  tax_rate: z.number().min(0).max(99),
  industry: z.string().max(120).nullable(),
  ai_context: z.object({ goals: z.string().max(2000), strategy: z.string().max(2000), market: z.string().max(2000), position: z.string().max(2000), other: z.string().max(2000) }),
});

export async function saveProfile(input: z.input<typeof ProfileSchema>): Promise<{ ok: boolean; error?: string }> {
  const v = ProfileSchema.safeParse(input);
  if (!v.success) return { ok: false, error: v.error.issues[0]?.message };
  const { supabase } = await getUser();
  const { error } = await supabase.from("companies").update({
    name: v.data.name, currency: v.data.currency.toUpperCase(), fy_start_month: v.data.fy_start_month, tax_rate: v.data.tax_rate / 100,
    industry: v.data.industry, ai_context: v.data.ai_context,
  }).eq("id", v.data.companyId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/company/${v.data.companyId}`, "layout");
  return { ok: true };
}

const KpiEntry = z.object({
  active: z.boolean().optional(), importance: z.enum(["Critical", "High", "Medium", "Low"]).optional(),
  target: z.number().finite().nullable().optional(), alert_active: z.boolean().optional(), alert_threshold: z.number().finite().nullable().optional(),
});
export async function saveKpiConfig(companyId: string, config: Record<string, z.infer<typeof KpiEntry>>): Promise<{ ok: boolean; error?: string }> {
  const parsed = z.record(z.string().regex(/^[a-z_]+$/), KpiEntry).safeParse(config);
  if (!parsed.success || !z.string().uuid().safeParse(companyId).success) return { ok: false, error: "Invalid KPI settings" };
  const { supabase } = await getUser();
  const { error } = await supabase.from("companies").update({ kpi_config: parsed.data as Json }).eq("id", companyId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/company/${companyId}`, "layout");
  return { ok: true };
}

export async function reclassify(companyId: string, changes: Record<string, string>): Promise<{ ok: boolean; error?: string; count?: number }> {
  const ok = z.record(z.string().uuid(), ClassEnum).safeParse(changes);
  if (!ok.success || !z.string().uuid().safeParse(companyId).success) return { ok: false, error: "Invalid changes" };
  const { supabase } = await getUser();
  const { data, error } = await supabase.rpc("reclassify_accounts", { p_company: companyId, p_changes: Object.fromEntries(Object.entries(ok.data).map(([k, c]) => [k, { class: c }])) as Json });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/company/${companyId}`, "layout");
  return { ok: true, count: data as number };
}

export async function deleteCompany(companyId: string): Promise<{ ok: boolean; error?: string }> {
  const { supabase } = await getUser();
  const { error, count } = await supabase.from("companies").delete({ count: "exact" }).eq("id", companyId);
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "Only organisation admins can delete a company." };
  revalidatePath("/companies");
  return { ok: true };
}

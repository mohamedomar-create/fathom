"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ClassKey } from "@/lib/engine";
import { ALL_CLASSES } from "@/lib/company/build";
import { checkKey, type Check } from "@/lib/company/checks";
import { planImport, unresolved, type MonthDiff, type TimelineCell } from "@/lib/company/import-plan";
import { loadVersion, saveCompanyData } from "@/lib/company/persist";
import { getUser } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

const ClassEnum = z.enum(ALL_CLASSES as [string, ...string[]]);
const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Ref = z.object({ sheet: z.string().max(120).optional(), row: z.number().int().min(0).optional(), label: z.string().max(300).optional() });
const CheckSchema = z.object({
  id: z.enum(["bs_balance", "control_total", "tb_zero", "unmapped", "duplicate", "multi_month", "re_rollforward", "cash_flow", "gap", "statement_mismatch", "sign", "opening"]),
  severity: z.enum(["block", "warn", "info"]), period: Period.optional(), statement: z.enum(["PL", "BS"]).optional(),
  title: z.string().max(200), detail: z.string().max(1000),
  expected: z.number().finite().optional(), actual: z.number().finite().optional(), diff: z.number().finite().optional(),
});
const PlanSchema = z.object({
  companyId: z.string().uuid(),
  mode: z.enum(["merge", "replace"]),
  slices: z.object({ PL: z.array(Period).max(600), BS: z.array(Period).max(600) }),
  accounts: z.array(z.object({
    code: z.string().max(40), name: z.string().min(1).max(300), cls: ClassEnum,
    amounts: z.record(Period, z.number().finite()),
    confidence: z.number().min(0).max(1).nullable().optional(),
    mapped_by: z.enum(["auto", "user", "system"]).optional(),
    ref: Ref.optional(),
  })).min(1).max(5000),
  controls: z.array(z.object({ metric: z.enum(["revenue", "gross_profit", "net_income", "ta", "tl", "te", "tle"]), period: Period, value: z.number().finite(), source: z.string().max(200) })).max(3000).default([]),
  extra: z.array(CheckSchema).max(500).default([]),
  ranges: z.record(Period, z.number().int().min(1).max(60)).default({}),
  openingFrom: Period.nullable().default(null),
});
const ImportSchema = PlanSchema.extend({
  filename: z.string().max(300).nullable(),
  report: z.object({
    kind: z.string(), periods: z.array(Period), warnings: z.array(z.string()), notes: z.array(z.string()), flips: z.array(z.string()),
    mapping: z.record(z.string(), z.string()),
  }),
  accept: z.object({ keys: z.array(z.string().max(80)).max(500), reason: z.string().trim().min(10, "Give a reason of at least 10 characters.").max(500) }).optional(),
});

export interface AcceptedItem { key: string; title: string; period?: string; reason: string; by: string; at: string }
export interface PreviewResult { timeline: TimelineCell[]; diffs: MonthDiff[]; checks: (Check & { accepted?: boolean })[]; accounts: number; hasData: boolean }
type Plan = z.output<typeof PlanSchema>;

/** Current data version, its accepted issues and notes, then the merged plan for this upload. */
async function buildPlan(supabase: Awaited<ReturnType<typeof getUser>>["supabase"], d: Plan) {
  const { data: c, error } = await supabase.from("companies").select("data_version, notes").eq("id", d.companyId).single();
  if (error || !c) throw new Error("Company not found.");
  const [current, { data: imp }] = await Promise.all([
    loadVersion(supabase, d.companyId, c.data_version),
    supabase.from("imports").select("report").eq("company_id", d.companyId).eq("data_version", c.data_version).eq("action", "import").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const prevAccepted = (((imp?.report ?? {}) as { accepted?: AcceptedItem[] }).accepted ?? []);
  const plan = planImport(current, d.accounts.map((a) => ({ ...a, cls: a.cls as ClassKey })), { mode: d.mode, slices: d.slices, controls: d.controls, extra: d.extra, ranges: d.ranges, openingFrom: d.openingFrom });
  return { plan, prevAccepted, hasData: current.length > 0, notes: ((c.notes ?? []) as string[]) };
}

export async function previewImport(input: z.input<typeof PlanSchema>): Promise<{ ok: true; data: PreviewResult } | { ok: false; error: string }> {
  const v = PlanSchema.safeParse(input);
  if (!v.success) return { ok: false, error: "The import data is not valid: " + v.error.issues[0]?.message };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  try {
    const { plan, prevAccepted, hasData } = await buildPlan(supabase, v.data);
    const ok = new Set(prevAccepted.map((a) => a.key));
    return { ok: true, data: { timeline: plan.timeline, diffs: plan.diffs, checks: plan.checks.map((c) => (ok.has(checkKey(c)) ? { ...c, accepted: true } : c)), accounts: plan.accounts.length, hasData } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function commitImport(input: z.input<typeof ImportSchema>): Promise<{ ok: true; version: number } | { ok: false; error: string; blocking?: Check[] }> {
  const v = ImportSchema.safeParse(input);
  if (!v.success) return { ok: false, error: "The import data is not valid: " + v.error.issues[0]?.message };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  try {
    const d = v.data;
    const { plan, prevAccepted, notes } = await buildPlan(supabase, d);
    const prevKeys = new Set(prevAccepted.map((a) => a.key));
    const newKeys = new Set(d.accept?.keys ?? []);
    const blocking = unresolved(plan.checks, [...prevKeys, ...newKeys]);
    if (blocking.length) return { ok: false, error: `${blocking.length} check${blocking.length > 1 ? "s" : ""} failed. Fix the mapping, or accept ${blocking.length > 1 ? "them" : "it"} with a reason.`, blocking };
    if (!plan.accounts.length) return { ok: false, error: "Nothing to import: every line is excluded or has no amounts." };
    // Accepted issues that still fail are carried into this version, with their original reason.
    const now = new Date().toISOString();
    const accepted: AcceptedItem[] = [];
    for (const c of plan.checks) {
      if (c.severity !== "block") continue;
      const key = checkKey(c);
      if (accepted.some((a) => a.key === key)) continue;
      const prev = prevAccepted.find((a) => a.key === key);
      if (prev) accepted.push(prev);
      else if (newKeys.has(key) && d.accept) accepted.push({ key, title: c.title, period: c.period, reason: d.accept.reason, by: user.email ?? user.id, at: now });
    }
    const fileNotes = [...d.report.flips, ...d.report.notes];
    const allNotes = d.mode === "merge" ? [...new Set([...notes, ...fileNotes])].slice(-30) : fileNotes;
    const wrote = (st: "PL" | "BS") => plan.timeline.filter((t) => t[st] === "new" || t[st] === "overwrite").map((t) => t.period);
    const touched = { PL: wrote("PL"), BS: wrote("BS") };
    const { version } = await saveCompanyData(supabase, d.companyId, plan.accounts, {
      kind: "upload", filename: d.filename,
      report: { ...d.report, mode: d.mode, slices: touched, accepted, diffs: plan.diffs.slice(0, 200), checks: plan.checks.filter((c) => c.severity !== "info").slice(0, 300) } as unknown as Json,
    }, allNotes);
    await supabase.from("companies").update({ source: "upload" }).eq("id", d.companyId).neq("source", "odoo");
    revalidatePath(`/company/${d.companyId}`, "layout");
    return { ok: true, version };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export interface Provenance { file: string; at: string | null; kind: string; sheet?: string; row?: number; label?: string }

/** Where the figures of some accounts came from, for the given months (file, upload time, sheet and row). */
export async function loadProvenance(companyId: string, accountIds: string[], periods: string[]): Promise<Record<string, Record<string, Provenance>>> {
  const ids = z.array(z.string().uuid()).max(400).safeParse(accountIds);
  const ps = z.array(Period).max(36).safeParse(periods);
  if (!z.string().uuid().safeParse(companyId).success || !ids.success || !ps.success || !ids.data.length) return {};
  const { supabase, user } = await getUser();
  if (!user) return {};
  const out: Record<string, Record<string, Provenance>> = {};
  for (let i = 0; i < ids.data.length; i += 100) {
    const chunk = ids.data.slice(i, i + 100);
    const [{ data: bal }, { data: acc }] = await Promise.all([
      supabase.from("account_balances").select("account_id, period, import_id").eq("company_id", companyId).in("account_id", chunk).in("period", ps.data),
      supabase.from("source_accounts").select("id, refs").eq("company_id", companyId).in("id", chunk),
    ]);
    const impIds = [...new Set((bal ?? []).map((b) => b.import_id).filter(Boolean) as string[])];
    const { data: imps } = impIds.length ? await supabase.from("imports").select("id, filename, created_at, kind").in("id", impIds) : { data: [] };
    const impById = new Map((imps ?? []).map((x) => [x.id, x]));
    const refs = new Map((acc ?? []).map((a) => [a.id, (a.refs ?? {}) as Record<string, { sheet?: string; row?: number; label?: string }>]));
    for (const b of bal ?? []) {
      const imp = b.import_id ? impById.get(b.import_id) : undefined;
      const ref = b.import_id ? refs.get(b.account_id)?.[b.import_id] : undefined;
      (out[b.account_id] ??= {})[b.period] = { file: imp?.filename ?? (imp?.kind === "odoo" ? "Odoo sync" : imp ? "Upload" : "Earlier import"), at: imp?.created_at ?? null, kind: imp?.kind ?? "upload", ...ref };
    }
  }
  return out;
}

/** Undo: make an earlier kept version current again. */
export async function restoreVersion(companyId: string, version: number): Promise<{ ok: boolean; error?: string }> {
  if (!z.string().uuid().safeParse(companyId).success || !Number.isInteger(version) || version < 1) return { ok: false, error: "Invalid version." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const { error } = await supabase.rpc("restore_company_version", { p_company: companyId, p_version: version });
  if (error) return { ok: false, error: error.code === "42501" ? "Only editors can restore data." : error.message };
  revalidatePath(`/company/${companyId}`, "layout");
  return { ok: true };
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
  const { error, count } = await supabase.from("companies").update({
    name: v.data.name, currency: v.data.currency.toUpperCase(), fy_start_month: v.data.fy_start_month, tax_rate: v.data.tax_rate / 100,
    industry: v.data.industry, ai_context: v.data.ai_context,
  }, { count: "exact" }).eq("id", v.data.companyId);
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "You do not have permission to change this." };
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
  const { error, count } = await supabase.from("companies").update({ kpi_config: parsed.data as Json }, { count: "exact" }).eq("id", companyId);
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "You do not have permission to change this." };
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

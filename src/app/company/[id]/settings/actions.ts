"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ClassKey } from "@/lib/engine";
import { LOCATION_TYPES, mergeLocationTypes, type LocationTypes } from "@/lib/ingest/inventory";
import { AssumptionsSchema } from "@/lib/company/assumptions-schema";
import { checkKey, type Check } from "@/lib/company/checks";
import { ClassEnum, ImportSchema, invalidImport, Period, PlanSchema } from "@/lib/company/import-schema";
import { planImport, statementMoves, unresolved, type MonthDiff, type Overlap, type TimelineCell } from "@/lib/company/import-plan";
import { loadVersion, saveCompanyData } from "@/lib/company/persist";
import { keepLedgerInStep } from "@/lib/company/ledger-lines";
import { clearedNotice } from "@/lib/company/ledger-tie";
import { rememberClasses, rememberedEntries } from "@/lib/company/account-map";
import { rememberKey } from "@/lib/ingest/pipeline";
import { getUser } from "@/lib/supabase/server";
import { ECONOMY_KEY, FORECAST_KEY, INVENTORY_KEY, RESERVED_KEYS } from "@/lib/company/load";
import { ForecastSchema } from "@/lib/company/forecast-schema";
import { validTimeZone, withProfile, withTimeZone } from "@/lib/company/time-zone";
import { dbError, safeError } from "@/lib/action-error";
import { limited, TOO_MANY } from "@/lib/rate-limit";
import type { Json } from "@/lib/supabase/database.types";

export interface AcceptedItem { key: string; title: string; period?: string; reason: string; by: string; at: string }
export interface PreviewResult { timeline: TimelineCell[]; diffs: MonthDiff[]; checks: (Check & { accepted?: boolean })[]; accounts: number; hasData: boolean; overlap: Overlap[] }
type Plan = z.output<typeof PlanSchema>;

/** Current data version, its accepted issues and notes, then the merged plan for this upload. */
async function buildPlan(supabase: Awaited<ReturnType<typeof getUser>>["supabase"], d: Plan) {
  const { data: c, error } = await supabase.from("companies").select("data_version, notes").eq("id", d.companyId).single();
  if (error || !c) throw new Error("Company not found, or you don't have access to it.");
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
  if (!v.success) return { ok: false, error: invalidImport(v.error, input) };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (await limited(supabase, "import", user.id)) return { ok: false, error: TOO_MANY };
  try {
    const { plan, prevAccepted, hasData } = await buildPlan(supabase, v.data);
    const ok = new Set(prevAccepted.map((a) => a.key));
    return { ok: true, data: { timeline: plan.timeline, diffs: plan.diffs, checks: plan.checks.map((c) => (ok.has(checkKey(c)) ? { ...c, accepted: true } : c)), accounts: plan.accounts.length, hasData, overlap: plan.overlap } };
  } catch (e) {
    return { ok: false, error: safeError(e, "previewImport") };
  }
}

export async function commitImport(input: z.input<typeof ImportSchema>): Promise<{ ok: true; version: number } | { ok: false; error: string; blocking?: Check[] }> {
  const v = ImportSchema.safeParse(input);
  if (!v.success) return { ok: false, error: invalidImport(v.error, input) };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (await limited(supabase, "import", user.id)) return { ok: false, error: TOO_MANY };
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
    const allNotes = d.mode !== "replace" ? [...new Set([...notes, ...fileNotes])].slice(-30) : fileNotes;
    const wrote = (st: "PL" | "BS") => plan.timeline.filter((t) => t[st] === "new" || t[st] === "overwrite").map((t) => t.period);
    const touched = { PL: wrote("PL"), BS: wrote("BS") };
    if (d.mode === "add" && !touched.PL.length && !touched.BS.length) return { ok: false, error: "Nothing new to add: every month in this file is already loaded." };
    const { version } = await saveCompanyData(supabase, d.companyId, plan.accounts, {
      kind: "upload", filename: d.filename,
      report: { ...d.report, mode: d.mode, slices: touched, accepted, diffs: plan.diffs.slice(0, 200), checks: plan.checks.filter((c) => c.severity !== "info").slice(0, 300) } as unknown as Json,
    }, allNotes);
    // The person's class choices become the company's account map: the next upload and every Odoo sync keep them.
    await rememberClasses(supabase, d.companyId, rememberedEntries(d.report.mapping, d.accounts));
    // Expense lines of earlier months follow those choices too (migration 0022).
    const { error: eStamp } = await supabase.rpc("restamp_expense_classes", { p_company: d.companyId });
    if (eStamp) console.error("commitImport: expense classes", eStamp.message);
    await supabase.from("companies").update({ source: "upload" }).eq("id", d.companyId).neq("source", "odoo");
    revalidatePath(`/company/${d.companyId}`, "layout");
    return { ok: true, version };
  } catch (e) {
    return { ok: false, error: safeError(e, "commitImport") };
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
export async function restoreVersion(companyId: string, version: number): Promise<{ ok: boolean; error?: string; notice?: string | null }> {
  if (!z.string().uuid().safeParse(companyId).success || !Number.isInteger(version) || version < 1) return { ok: false, error: "Invalid version." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const { error } = await supabase.rpc("restore_company_version", { p_company: companyId, p_version: version });
  if (error) return { ok: false, error: error.code === "42501" ? "Only editors can restore data." : dbError(error, "restoreVersion") };
  // Sales and expense lines taken from a ledger follow the accounts: months that no longer tie to the restored P&L lose them.
  let notice: string | null = null;
  try { notice = clearedNotice(await keepLedgerInStep(supabase, companyId, await loadVersion(supabase, companyId, version))); }
  catch (e) { console.error("restoreVersion: ledger lines", e); }
  revalidatePath(`/company/${companyId}`, "layout");
  return { ok: true, notice };
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
  time_zone: z.string().max(64).refine(validTimeZone, "Choose a time zone from the list").nullable().optional(),
});

export async function saveProfile(input: z.input<typeof ProfileSchema>): Promise<{ ok: boolean; error?: string }> {
  const v = ProfileSchema.safeParse(input);
  if (!v.success) return { ok: false, error: v.error.issues[0]?.message };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  // The time zone is kept with the company's other settings (kpi_config), never overwriting them.
  let kpi: Json | undefined;
  if (v.data.time_zone !== undefined) {
    const { data: row, error: e1 } = await supabase.from("companies").select("kpi_config").eq("id", v.data.companyId).maybeSingle();
    if (e1) return { ok: false, error: dbError(e1, "saveProfile") };
    if (!row) return { ok: false, error: "You do not have permission to change this." };
    kpi = withTimeZone(row.kpi_config, v.data.time_zone) as Json;
  }
  const { error, count } = await supabase.from("companies").update({
    name: v.data.name, currency: v.data.currency.toUpperCase(), fy_start_month: v.data.fy_start_month, tax_rate: v.data.tax_rate / 100,
    industry: v.data.industry, ai_context: v.data.ai_context, ...(kpi !== undefined ? { kpi_config: kpi } : {}),
  }, { count: "exact" }).eq("id", v.data.companyId);
  if (error) return { ok: false, error: dbError(error, "saveProfile") };
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
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  // The economic assumptions and forecast drivers share this column; keep them when the KPI settings are saved.
  const { data: row } = await supabase.from("companies").select("kpi_config").eq("id", companyId).maybeSingle();
  const old = (row?.kpi_config ?? {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...parsed.data };
  for (const k of RESERVED_KEYS) {
    delete next[k];
    if (old[k] !== undefined) next[k] = old[k];
  }
  const { error, count } = await supabase.from("companies").update({ kpi_config: next as Json }, { count: "exact" }).eq("id", companyId);
  if (error) return { ok: false, error: dbError(error, "saveKpiConfig") };
  if (!count) return { ok: false, error: "You do not have permission to change this." };
  revalidatePath(`/company/${companyId}`, "layout");
  return { ok: true };
}

/** Inflation, exchange rates and borrowing terms used by the bank-readiness and real-profit views. */
export async function saveAssumptions(companyId: string, input: z.input<typeof AssumptionsSchema>): Promise<{ ok: boolean; error?: string }> {
  const v = AssumptionsSchema.safeParse(input);
  if (!v.success) return { ok: false, error: v.error.issues[0]?.message ?? "Invalid figures" };
  if (!z.string().uuid().safeParse(companyId).success) return { ok: false, error: "Invalid company" };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const { data: row, error: e1 } = await supabase.from("companies").select("kpi_config").eq("id", companyId).maybeSingle();
  if (e1) return { ok: false, error: dbError(e1, "saveAssumptions") };
  if (!row) return { ok: false, error: "You do not have permission to change this." };
  const clean = Object.fromEntries(Object.entries(v.data).filter(([, x]) => x !== null && x !== undefined && x !== ""));
  const next = { ...((row.kpi_config ?? {}) as Record<string, unknown>), [ECONOMY_KEY]: clean };
  const { error, count } = await supabase.from("companies").update({ kpi_config: next as Json }, { count: "exact" }).eq("id", companyId);
  if (error) return { ok: false, error: dbError(error, "saveAssumptions") };
  if (!count) return { ok: false, error: "You do not have permission to change this." };
  revalidatePath(`/company/${companyId}`, "layout");
  return { ok: true };
}

/** Inventory settings: the location rented items go to (null: found by its name, "Rental" or "تأجير"). */
export async function saveInventorySettings(companyId: string, input: { rentalLocation: string | null; locationTypes?: LocationTypes; from?: "person" | "export" }): Promise<{ ok: boolean; error?: string }> {
  const v = z.object({ rentalLocation: z.string().trim().max(200).nullable(), locationTypes: z.record(z.string().max(300), z.enum(LOCATION_TYPES)).refine((o) => Object.keys(o).length <= 2000).optional(), from: z.enum(["person", "export"]).optional() }).safeParse(input);
  if (!v.success || !z.string().uuid().safeParse(companyId).success) return { ok: false, error: "Invalid request." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const { data: row, error: e1 } = await supabase.from("companies").select("kpi_config").eq("id", companyId).maybeSingle();
  if (e1) return { ok: false, error: dbError(e1, "saveInventorySettings") };
  if (!row) return { ok: false, error: "You do not have permission to change this." };
  const cfg = (row.kpi_config ?? {}) as Record<string, unknown>;
  const was = (cfg[INVENTORY_KEY] ?? {}) as { locationTypes?: LocationTypes };
  // Location types are kept unless new ones are given (Odoo's own types from an export, or the person's choice).
  const next = { ...cfg, [INVENTORY_KEY]: { rentalLocation: v.data.rentalLocation || null, locationTypes: mergeLocationTypes(was.locationTypes ?? {}, v.data.locationTypes ?? {}, v.data.from ?? "person") } };
  const { error, count } = await supabase.from("companies").update({ kpi_config: next as Json }, { count: "exact" }).eq("id", companyId);
  if (error) return { ok: false, error: dbError(error, "saveInventorySettings") };
  if (!count) return { ok: false, error: "You do not have permission to change this." };
  revalidatePath(`/company/${companyId}`, "layout");
  return { ok: true };
}

/** The company's books start from zero (no history before the first month): no opening balance is due. */
export async function setBooksFromZero(companyId: string, value: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!z.string().uuid().safeParse(companyId).success || typeof value !== "boolean") return { ok: false, error: "Invalid request." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const { data: row, error: e1 } = await supabase.from("companies").select("kpi_config").eq("id", companyId).maybeSingle();
  if (e1) return { ok: false, error: dbError(e1, "setBooksFromZero") };
  if (!row) return { ok: false, error: "You do not have permission to change this." };
  const { error, count } = await supabase.from("companies").update({ kpi_config: withProfile(row.kpi_config, { booksFromZero: value }) as Json }, { count: "exact" }).eq("id", companyId);
  if (error) return { ok: false, error: dbError(error, "setBooksFromZero") };
  if (!count) return { ok: false, error: "You do not have permission to change this." };
  revalidatePath(`/company/${companyId}`, "layout");
  return { ok: true };
}

/** Forecast drivers: growth, margin, working-capital days, investment, borrowing and dividends. */
export async function saveForecast(companyId: string, input: z.input<typeof ForecastSchema>): Promise<{ ok: boolean; error?: string }> {
  const v = ForecastSchema.safeParse(input);
  if (!v.success) return { ok: false, error: v.error.issues[0]?.message ?? "Invalid figures" };
  if (!z.string().uuid().safeParse(companyId).success) return { ok: false, error: "Invalid company" };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const { data: row, error: e1 } = await supabase.from("companies").select("kpi_config").eq("id", companyId).maybeSingle();
  if (e1) return { ok: false, error: dbError(e1, "saveForecast") };
  if (!row) return { ok: false, error: "You do not have permission to change this." };
  const clean = Object.fromEntries(Object.entries(v.data).filter(([, x]) => x !== null && x !== undefined && x !== ""));
  const next = { ...((row.kpi_config ?? {}) as Record<string, unknown>), [FORECAST_KEY]: clean };
  const { error, count } = await supabase.from("companies").update({ kpi_config: next as Json }, { count: "exact" }).eq("id", companyId);
  if (error) return { ok: false, error: dbError(error, "saveForecast") };
  if (!count) return { ok: false, error: "You do not have permission to change this." };
  revalidatePath(`/company/${companyId}`, "layout");
  return { ok: true };
}

export async function reclassify(companyId: string, changes: Record<string, string>): Promise<{ ok: boolean; error?: string; count?: number; notice?: string | null }> {
  const ok = z.record(z.string().uuid(), ClassEnum).safeParse(changes);
  if (!ok.success || !z.string().uuid().safeParse(companyId).success) return { ok: false, error: "Invalid changes" };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  // A stored month is a movement on the P&L and a closing balance on the balance sheet: moving an account across would
  // turn one into the other, so that change is made by re-importing the file with the new class instead.
  const { data: cur, error: e0 } = await supabase.from("source_accounts").select("id, class, code, name").eq("company_id", companyId).in("id", Object.keys(ok.data));
  if (e0) return { ok: false, error: dbError(e0, "reclassify") };
  if (statementMoves(cur ?? [], ok.data).length) return { ok: false, error: "That would move an account between the P&L and the balance sheet, and its stored months can't be converted. Re-import the file with the account mapped to its new class instead." };
  const { data, error } = await supabase.rpc("reclassify_accounts", { p_company: companyId, p_changes: Object.fromEntries(Object.entries(ok.data).map(([k, c]) => [k, { class: c }])) as Json });
  if (error) return { ok: false, error: dbError(error, "reclassify") };
  // Kept in the company's account map, so the next upload or Odoo sync does not undo it.
  await rememberClasses(supabase, companyId, (cur ?? []).map((a) => ({ key: rememberKey({ code: a.code, label: a.name }), cls: ok.data[a.id] as ClassKey, name: a.name })));
  // Stored expense lines take the new class too (migration 0022; until it is applied the call fails harmlessly).
  const { error: e2 } = await supabase.rpc("restamp_expense_classes", { p_company: companyId });
  if (e2) console.error("reclassify: expense classes", e2.message);
  // Sales and expense lines taken from a ledger follow the accounts: months that no longer tie to the new P&L lose them.
  let notice: string | null = null;
  try {
    const { data: co } = await supabase.from("companies").select("data_version").eq("id", companyId).maybeSingle();
    if (co?.data_version) notice = clearedNotice(await keepLedgerInStep(supabase, companyId, await loadVersion(supabase, companyId, co.data_version)));
  } catch (e) { console.error("reclassify: ledger lines", e); }
  revalidatePath(`/company/${companyId}`, "layout");
  return { ok: true, count: data as number, notice };
}

export async function deleteCompany(companyId: string): Promise<{ ok: boolean; error?: string }> {
  if (!z.string().uuid().safeParse(companyId).success) return { ok: false, error: "That value isn't valid." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const { error, count } = await supabase.from("companies").delete({ count: "exact" }).eq("id", companyId);
  if (error) return { ok: false, error: dbError(error, "deleteCompany") };
  if (!count) return { ok: false, error: "Only organisation admins can delete a company." };
  revalidatePath("/companies");
  return { ok: true };
}

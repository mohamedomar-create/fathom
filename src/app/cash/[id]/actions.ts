"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { dbError } from "@/lib/action-error";
import { limited, TOO_MANY } from "@/lib/rate-limit";
import { withCashColumns, withMode, withOpeningCash } from "@/lib/company/mode";
import type { Json } from "@/lib/supabase/database.types";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const Id = z.string().uuid();
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Entry = z.object({
  day: Day, direction: z.enum(["in", "out"]), amount: z.number().finite().refine((v) => v !== 0, "An amount is needed."),
  category: z.string().max(200).default(""), party: z.string().max(200).default(""), note: z.string().max(300).default(""),
  paid: z.boolean().nullable().default(null), paidOn: Day.nullable().default(null),
});
export type EntryInput = z.input<typeof Entry>;
const FIELDS = ["date", "in", "out", "amount", "qty", "price", "balance", "type", "category", "party", "note", "paid", "paidOn", ""] as const;

/** The database's own reason when it refuses a value ("a date is needed"), else the safe message. */
const said = (e: { code?: string; message: string }, ctx: string) =>
  e.code === "22023" && e.message.length < 200 ? e.message.charAt(0).toUpperCase() + e.message.slice(1) + "." : e.code === "PGRST202" ? "The cash book needs the latest database update (migration 0037). Ask the site owner to run it." : dbError(e, ctx);
const refresh = (id: string) => revalidatePath(`/cash/${id}`, "layout");
async function editor(scope: "sales" | "cash_entry" = "sales") {
  const { supabase, user } = await getUser();
  if (!user) return { error: "Please sign in again." as const };
  if (await limited(supabase, scope, user.id)) return { error: TOO_MANY };
  return { supabase };
}

/** Opens an upload; its entries go in parts (uploadPart) and show only when it is finished (uploadFinish). */
export async function uploadBegin(companyId: string, filename: string, months: string[], mode: "add" | "replace_months", skipped: number, directions: ("in" | "out")[] = ["in", "out"]): Promise<Result<{ upload: string }>> {
  const v = z.object({ companyId: Id, filename: z.string().max(300), months: z.array(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)).max(600), mode: z.enum(["add", "replace_months"]), skipped: z.number().int().min(0),
    directions: z.array(z.enum(["in", "out"])).min(1).max(2) })
    .safeParse({ companyId, filename, months, mode, skipped, directions });
  if (!v.success) return { ok: false, error: "The upload is not valid: " + v.error.issues[0]?.message };
  const s = await editor();
  if ("error" in s) return { ok: false, error: s.error! };
  const { data, error } = await s.supabase.rpc("cash_upload_begin", { p_company: v.data.companyId, p_filename: v.data.filename, p_months: v.data.months, p_mode: v.data.mode, p_skipped: v.data.skipped, p_directions: v.data.directions });
  if (error) return { ok: false, error: said(error, "uploadBegin") };
  return { ok: true, upload: data as string };
}

export async function uploadPart(upload: string, entries: EntryInput[]): Promise<Result<{ added: number }>> {
  const v = z.object({ upload: Id, entries: z.array(Entry).min(1).max(5000) }).safeParse({ upload, entries });
  if (!v.success) return { ok: false, error: "An entry is not valid: " + v.error.issues[0]?.message };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const { data, error } = await supabase.rpc("cash_upload_add", { p_upload: v.data.upload, p_entries: v.data.entries as unknown as Json });
  if (error) return { ok: false, error: said(error, "uploadPart") };
  return { ok: true, added: Number(data) };
}

export async function uploadFinish(companyId: string, upload: string): Promise<Result<{ rows: number; removed: number }>> {
  if (!Id.safeParse(upload).success || !Id.safeParse(companyId).success) return { ok: false, error: "That upload isn't valid." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const { data, error } = await supabase.rpc("cash_upload_finish", { p_upload: upload });
  if (error) return { ok: false, error: said(error, "uploadFinish") };
  refresh(companyId);
  const r = (data ?? {}) as { rows?: number; removed?: number };
  return { ok: true, rows: Number(r.rows ?? 0), removed: Number(r.removed ?? 0) };
}

export async function uploadRemove(companyId: string, upload: string): Promise<Result> {
  if (!Id.safeParse(upload).success || !Id.safeParse(companyId).success) return { ok: false, error: "That upload isn't valid." };
  const s = await editor();
  if ("error" in s) return { ok: false, error: s.error! };
  const { error } = await s.supabase.rpc("cash_upload_remove", { p_upload: upload });
  if (error) return { ok: false, error: said(error, "uploadRemove") };
  refresh(companyId);
  return { ok: true };
}

export async function entryAdd(companyId: string, entry: EntryInput): Promise<Result> {
  const v = Entry.safeParse(entry);
  if (!Id.safeParse(companyId).success) return { ok: false, error: "That business isn't valid." };
  if (!v.success) return { ok: false, error: v.error.issues[0]?.message ?? "That entry isn't valid." };
  const s = await editor("cash_entry");
  if ("error" in s) return { ok: false, error: s.error! };
  const { error } = await s.supabase.rpc("cash_entry_add", { p_company: companyId, p_entry: v.data as unknown as Json });
  if (error) return { ok: false, error: said(error, "entryAdd") };
  refresh(companyId);
  return { ok: true };
}

export async function entryUpdate(companyId: string, id: number, entry: EntryInput): Promise<Result> {
  const v = Entry.safeParse(entry);
  if (!v.success || !Number.isInteger(id) || id <= 0) return { ok: false, error: v.success ? "That entry isn't valid." : v.error.issues[0]?.message ?? "That entry isn't valid." };
  const s = await editor("cash_entry");
  if ("error" in s) return { ok: false, error: s.error! };
  const { error } = await s.supabase.rpc("cash_entry_update", { p_id: id, p_entry: v.data as unknown as Json });
  if (error) return { ok: false, error: said(error, "entryUpdate") };
  refresh(companyId);
  return { ok: true };
}

export async function entryDelete(companyId: string, id: number): Promise<Result> {
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "That entry isn't valid." };
  const s = await editor("cash_entry");
  if ("error" in s) return { ok: false, error: s.error! };
  const { error } = await s.supabase.rpc("cash_entry_delete", { p_id: id });
  if (error) return { ok: false, error: said(error, "entryDelete") };
  refresh(companyId);
  return { ok: true };
}

/** The business's settings and remembered column choices, kept with its other settings. */
async function patchProfile(companyId: string, patch: (cfg: unknown) => unknown, extra: { name?: string; currency?: string } = {}): Promise<Result> {
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const { data: row, error: e1 } = await supabase.from("companies").select("kpi_config").eq("id", companyId).maybeSingle();
  if (e1) return { ok: false, error: dbError(e1, "cashSettings") };
  if (!row) return { ok: false, error: "You do not have permission to change this." };
  const { error, count } = await supabase.from("companies").update({ kpi_config: patch(row.kpi_config) as Json, ...extra }, { count: "exact" }).eq("id", companyId);
  if (error) return { ok: false, error: dbError(error, "cashSettings") };
  if (!count) return { ok: false, error: "You do not have permission to change this." };
  refresh(companyId);
  return { ok: true };
}

export async function saveCashSettings(companyId: string, input: { name: string; currency: string; opening: { amount: number; asOf: string } | null }): Promise<Result> {
  const v = z.object({ companyId: Id, name: z.string().trim().min(1, "A name is needed.").max(120), currency: z.string().trim().min(3).max(6),
    opening: z.object({ amount: z.number().finite(), asOf: Day }).nullable() }).safeParse({ companyId, ...input });
  if (!v.success) return { ok: false, error: v.error.issues[0]?.message ?? "That value isn't valid." };
  return patchProfile(v.data.companyId, (cfg) => withOpeningCash(cfg, v.data.opening), { name: v.data.name, currency: v.data.currency.toUpperCase() });
}

export async function rememberColumns(companyId: string, map: Record<string, string>): Promise<Result> {
  const v = z.object({ companyId: Id, map: z.record(z.string().min(1).max(120), z.enum(FIELDS)).refine((m) => Object.keys(m).length <= 60) }).safeParse({ companyId, map });
  if (!v.success) return { ok: false, error: "Those column choices aren't valid." };
  return patchProfile(v.data.companyId, (cfg) => withCashColumns(cfg, v.data.map));
}

/** To the full system: the entries are copied into sales and expense lines once; the cash book is kept. */
export async function switchToFull(companyId: string): Promise<Result> {
  if (!Id.safeParse(companyId).success) return { ok: false, error: "That business isn't valid." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const { error } = await supabase.rpc("cash_to_full", { p_company: companyId });
  if (error) return { ok: false, error: said(error, "switchToFull") };
  const r = await patchProfile(companyId, (cfg) => withMode(cfg, "full"));
  if (r.ok) revalidatePath(`/company/${companyId}`, "layout");
  return r;
}

export async function clearCashBook(companyId: string): Promise<Result> {
  if (!Id.safeParse(companyId).success) return { ok: false, error: "That business isn't valid." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const { error } = await supabase.rpc("cash_entries_clear", { p_company: companyId });
  if (error) return { ok: false, error: said(error, "clearCashBook") };
  refresh(companyId);
  return { ok: true };
}

/** From the full system to the cash book: uploaded sales and expense lines are copied in when the cash book is empty. */
export async function switchToCash(companyId: string): Promise<Result> {
  if (!Id.safeParse(companyId).success) return { ok: false, error: "That business isn't valid." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const { error } = await supabase.rpc("cash_from_full", { p_company: companyId });
  if (error) return { ok: false, error: said(error, "switchToCash") };
  const r = await patchProfile(companyId, (cfg) => withMode(cfg, "simple"));
  if (r.ok) revalidatePath(`/company/${companyId}`, "layout");
  return r;
}

"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { dbError, safeError } from "@/lib/action-error";
import type { Json } from "@/lib/supabase/database.types";
import { withProfile } from "@/lib/company/time-zone";

const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Amount = z.number().finite().refine((v) => Math.abs(v) < 1e15, "amount out of range");
const Check = z.object({
  file: z.string().min(1).max(200),
  months: z.array(Period).max(600),
  diffs: z.array(z.object({ period: Period, account: z.string().min(1).max(300), books: Amount, file: Amount, diff: Amount })).max(2000),
});

/**
 * Keeps a Trial Balance check (the file read against the books, never saved as data) in the company profile, so the
 * Data steps show it: when, which file, the months compared and every difference. Editors only (the update is refused
 * by row security for anyone else). The books themselves are not touched.
 */
export async function saveTbCheck(companyId: string, check: z.input<typeof Check>): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = z.string().uuid().safeParse(companyId);
  const v = Check.safeParse(check);
  if (!id.success || !v.success) return { ok: false, error: "The check is not valid." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  try {
    const { data: row, error: e1 } = await supabase.from("companies").select("kpi_config").eq("id", companyId).maybeSingle();
    if (e1) return { ok: false, error: dbError(e1, "saveTbCheck") };
    if (!row) return { ok: false, error: "You do not have permission to change this." };
    const tbCheck = { at: new Date().toISOString(), ...v.data };
    const { error, count } = await supabase.from("companies").update({ kpi_config: withProfile(row.kpi_config, { tbCheck }) as Json }, { count: "exact" }).eq("id", companyId);
    if (error) return { ok: false, error: dbError(error, "saveTbCheck") };
    if (!count) return { ok: false, error: "You do not have permission to change this." };
    revalidatePath(`/company/${companyId}`, "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: safeError(e, "saveTbCheck") };
  }
}

const Choice = z.object({ kind: z.enum(["alias", "order", "agency", "not_agency"]), key: z.string().trim().min(1).max(200), hospital: z.string().trim().max(200) });

/**
 * Saves the company's own end-user choices: one hospital for two spellings ('alias'), an agency order number's hospital
 * ('order'), or a customer marked as an agency or as not one. Editors only (row security refuses anyone else).
 */
export async function saveEndUserChoices(companyId: string, choices: z.input<typeof Choice>[]): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  const id = z.string().uuid().safeParse(companyId);
  const v = z.array(Choice).min(1).max(2000).safeParse(choices);
  if (!id.success || !v.success) return { ok: false, error: "Those choices are not valid." };
  const bad = v.data.find((c) => (c.kind === "alias" || c.kind === "order") && !c.hospital);
  if (bad) return { ok: false, error: `Give the hospital for "${bad.key}".` };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  try {
    const rows = [...new Map(v.data.map((c) => [`${c.kind}|${c.key}`, { company_id: companyId, kind: c.kind, key: c.key, hospital: c.hospital }])).values()];
    const { error } = await supabase.from("end_user_map").upsert(rows, { onConflict: "company_id,kind,key" });
    if (error) return { ok: false, error: dbError(error, "saveEndUserChoices") };
    // Marking a customer as an agency undoes "not an agency" and the other way round.
    for (const r of rows.filter((x) => x.kind === "agency" || x.kind === "not_agency")) {
      await supabase.from("end_user_map").delete().eq("company_id", companyId).eq("kind", r.kind === "agency" ? "not_agency" : "agency").eq("key", r.key);
    }
    revalidatePath(`/company/${companyId}`, "layout");
    return { ok: true, saved: rows.length };
  } catch (e) {
    return { ok: false, error: safeError(e, "saveEndUserChoices") };
  }
}

export async function removeEndUserChoice(companyId: string, kind: z.input<typeof Choice>["kind"], key: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const v = z.object({ id: z.string().uuid(), kind: Choice.shape.kind, key: Choice.shape.key }).safeParse({ id: companyId, kind, key });
  if (!v.success) return { ok: false, error: "That choice is not valid." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  try {
    const { error, count } = await supabase.from("end_user_map").delete({ count: "exact" }).eq("company_id", companyId).eq("kind", v.data.kind).eq("key", v.data.key);
    if (error) return { ok: false, error: dbError(error, "removeEndUserChoice") };
    if (!count) return { ok: false, error: "You do not have permission to change this." };
    revalidatePath(`/company/${companyId}`, "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: safeError(e, "removeEndUserChoice") };
  }
}

const AgencyLineIn = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), dn: z.string().max(80), ref: z.string().max(80), hospital: z.string().trim().min(1).max(200),
  funding: z.string().max(120), region: z.string().max(60), value: Amount, sheet: z.string().max(120),
});

/**
 * Keeps a buying agency's statement (each delivery's hospital, funding and region), replacing the company's previous one.
 * It only says whose each agency invoice was: it is stored apart and never touches sales lines, balances or receivables.
 */
export async function saveAgencyStatement(companyId: string, input: { filename: string; sheets: string[]; report: { lines: number; total: number; issues: string[] }; lines: z.input<typeof AgencyLineIn>[] }): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  const id = z.string().uuid().safeParse(companyId);
  const v = z.object({
    filename: z.string().min(1).max(300), sheets: z.array(z.string().max(120)).max(30),
    report: z.object({ lines: z.number().int().min(0), total: Amount, issues: z.array(z.string().max(500)).max(50) }),
    lines: z.array(AgencyLineIn).min(1).max(20000),
  }).safeParse(input);
  if (!id.success || !v.success) return { ok: false, error: "The statement is not valid." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  try {
    const { data, error } = await supabase.rpc("save_agency_statement", { p_company: companyId, p_filename: v.data.filename, p_sheets: v.data.sheets, p_report: v.data.report as Json, p_lines: v.data.lines as unknown as Json });
    if (error) return { ok: false, error: dbError(error, "saveAgencyStatement") };
    revalidatePath(`/company/${companyId}`, "layout");
    return { ok: true, saved: Number(data ?? 0) };
  } catch (e) {
    return { ok: false, error: safeError(e, "saveAgencyStatement") };
  }
}

export async function removeAgencyStatement(companyId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!z.string().uuid().safeParse(companyId).success) return { ok: false, error: "That value isn't valid." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  try {
    const { error } = await supabase.rpc("remove_agency_statement", { p_company: companyId });
    if (error) return { ok: false, error: dbError(error, "removeAgencyStatement") };
    revalidatePath(`/company/${companyId}`, "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: safeError(e, "removeAgencyStatement") };
  }
}

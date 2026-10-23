"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { lineProblem, zodProblem } from "@/lib/preflight/server";
import { getUser } from "@/lib/supabase/server";
import { dbError, safeError } from "@/lib/action-error";
import { limited, TOO_MANY } from "@/lib/rate-limit";
import type { Json } from "@/lib/supabase/database.types";
import { stageAdd, stageBegin, stageFinish } from "@/lib/company/line-stage";
import { controlAccountsOf, withProfile } from "@/lib/company/time-zone";

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Amount = z.number().finite().refine((v) => Math.abs(v) < 1e15, "amount out of range");
const Aged = z.object({
  companyId: z.string().uuid(),
  side: z.enum(["receivable", "payable"]),
  asOf: Day,
  buckets: z.array(z.string().max(40)).min(1).max(12),
  total: z.object({ amounts: z.array(Amount).max(12), total: Amount }),
  findings: z.array(z.object({ id: z.string().max(40), message: z.string().max(1000) })).max(20),
  filename: z.string().max(300),
  items: z.array(z.object({ partner: z.string().max(200), ref: z.string().max(120), memo: z.string().max(300), day: Day.nullable(), amounts: z.array(Amount).max(12), total: Amount })).max(20000),
});
const Line = z.object({
  day: Day, period: Period, number: z.string().max(80), journal: z.string().max(120), method: z.string().max(120), partner: z.string().max(200),
  direction: z.enum(["in", "out"]), amount: Amount, currency: z.string().max(10), amount_currency: Amount.nullable(), state: z.enum(["paid", "in_process"]),
  kind: z.enum(["", "customers", "suppliers", "transfer", "other"]).optional(), counter: z.string().max(40).optional(),
});

/** Saves one Aged Receivable / Aged Payable report, replacing the company's report for that side and date. */
export async function saveAgedReport(input: z.input<typeof Aged>): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  const v = Aged.safeParse(input);
  if (!v.success) return { ok: false, error: "The ageing report is not valid: " + v.error.issues[0]?.message };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (await limited(supabase, "payments", user.id)) return { ok: false, error: TOO_MANY };
  try {
    const d = v.data;
    const { data, error } = await supabase.rpc("save_aged_report", {
      p_company: d.companyId, p_side: d.side, p_as_of: d.asOf, p_buckets: d.buckets, p_totals: d.total as unknown as Json,
      p_findings: d.findings as unknown as Json, p_filename: d.filename, p_items: d.items as unknown as Json,
    });
    if (error) return { ok: false, error: dbError(error, "save_aged_report") };
    revalidatePath(`/company/${d.companyId}`, "layout");
    return { ok: true, saved: data as number };
  } catch (e) {
    return { ok: false, error: safeError(e, "saveAgedReport") };
  }
}

/** Opens a payments batch: the company's payments from this source (a payments file, or the General Ledger's bank and
 *  cash entries) for these months are replaced by the lines added next. */
export async function startPaymentBatch(companyId: string, periods: string[], filename: string, source: "file" | "ledger" = "file", all = false): Promise<{ ok: true; batch: string; staged: boolean } | { ok: false; error: string }> {
  const v = z.object({ companyId: z.string().uuid(), periods: z.array(Period).min(1).max(600), filename: z.string().max(300), source: z.enum(["file", "ledger"]) }).safeParse({ companyId, periods, filename, source });
  if (!v.success) return { ok: false, error: "The payments are not valid: " + v.error.issues[0]?.message };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (await limited(supabase, "payments", user.id)) return { ok: false, error: TOO_MANY };
  try {
    const months = [...new Set(periods)].sort();
    const st = await stageBegin(supabase, "payments", { companyId, source, periods: months, filename, all });
    if (st.ok) return { ok: true, batch: st.stage, staged: true };
    if (!st.missing) return st;
    if (months.length > 240) return { ok: false, error: "Saving more than 240 months at once needs the latest database update (migration 0035). Ask the site owner to run it." };
    const { data, error } = await supabase.rpc("begin_payment_batch", { p_company: companyId, p_periods: months, p_filename: filename, p_report: {} as Json, ...(source === "ledger" ? { p_source: source } : {}) });
    if (error) return { ok: false, error: dbError(error, "begin_payment_batch") };
    return { ok: true, batch: data as string, staged: false };
  } catch (e) {
    return { ok: false, error: safeError(e, "startPaymentBatch") };
  }
}

/** Adds up to 4,000 payments to an open save. */
export async function addPaymentLines(companyId: string, batch: string, lines: z.input<typeof Line>[], last: boolean, staged = false): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  const ids = z.object({ companyId: z.string().uuid(), batch: z.string().uuid() }).safeParse({ companyId, batch });
  const ls = z.array(Line).min(1).max(4000).safeParse(lines);
  if (!ids.success) return { ok: false, error: "The payments are not valid." };
  if (!ls.success) return { ok: false, error: zodProblem(ls.error, "payment") };
  const wrongMonth = lineProblem(ls.data, "payment");
  if (wrongMonth) return { ok: false, error: wrongMonth };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  try {
    if (staged) return await stageAdd(supabase, batch, ls.data);
    const { data, error } = await supabase.rpc("add_payment_lines", { p_batch: batch, p_lines: ls.data as unknown as Json });
    if (error) return { ok: false, error: dbError(error, "add_payment_lines") };
    if (last) revalidatePath(`/company/${companyId}`, "layout");
    return { ok: true, saved: data as number };
  } catch (e) {
    return { ok: false, error: safeError(e, "addPaymentLines") };
  }
}

/** Finishes a staged payments save: the source's payments in its months are replaced in one step (even by none). */
export async function finishPaymentBatch(companyId: string, stage: string): Promise<{ ok: true; saved: number; sent: number } | { ok: false; error: string }> {
  if (!z.object({ companyId: z.string().uuid(), stage: z.string().uuid() }).safeParse({ companyId, stage }).success) return { ok: false, error: "The payments are not valid." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  try {
    const f = await stageFinish(supabase, stage);
    if (!f.ok) return f;
    revalidatePath(`/company/${companyId}`, "layout");
    return { ok: true, saved: f.saved, sent: f.sent };
  } catch (e) {
    return { ok: false, error: safeError(e, "finishPaymentBatch") };
  }
}

/** The account(s) an ageing report is kept on, chosen once and remembered in the company profile (editors). */
export async function saveControlAccounts(companyId: string, side: "receivable" | "payable", codes: string[]): Promise<{ ok: boolean; error?: string }> {
  const v = z.object({ companyId: z.string().uuid(), side: z.enum(["receivable", "payable"]), codes: z.array(z.string().min(1).max(40)).max(20) }).safeParse({ companyId, side, codes });
  if (!v.success) return { ok: false, error: "The accounts chosen are not valid." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  try {
    const { data: row, error: e1 } = await supabase.from("companies").select("kpi_config").eq("id", companyId).maybeSingle();
    if (e1) return { ok: false, error: dbError(e1, "saveControlAccounts") };
    if (!row) return { ok: false, error: "You do not have permission to change this." };
    const now = controlAccountsOf(row.kpi_config);
    const { error, count } = await supabase.from("companies").update({ kpi_config: withProfile(row.kpi_config, { controlAccounts: { ...now, [side]: v.data.codes } }) as Json }, { count: "exact" }).eq("id", companyId);
    if (error) return { ok: false, error: dbError(error, "saveControlAccounts") };
    if (!count) return { ok: false, error: "You do not have permission to change this." };
    revalidatePath(`/company/${companyId}`, "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: safeError(e, "saveControlAccounts") };
  }
}

/** Removes one payments upload, or one ageing report, with every line it holds (Data health; editors). */
export async function removePaymentsUpload(companyId: string, kind: "payments" | "aged", id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const v = z.object({ companyId: z.string().uuid(), kind: z.enum(["payments", "aged"]), id: z.string().uuid() }).safeParse({ companyId, kind, id });
  if (!v.success) return { ok: false, error: "Invalid request." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  try {
    const { data, error } = await supabase.from(kind === "payments" ? "payment_batches" : "aged_reports").delete().eq("id", id).eq("company_id", companyId).select("id");
    if (error) return { ok: false, error: dbError(error, "removePaymentsUpload") };
    if (!data?.length) return { ok: false, error: "Only editors can remove uploads." };
    revalidatePath(`/company/${companyId}`, "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: safeError(e, "removePaymentsUpload") };
  }
}

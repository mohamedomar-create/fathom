"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { zodProblem } from "@/lib/preflight/server";
import { getUser } from "@/lib/supabase/server";
import { dbError, safeError } from "@/lib/action-error";
import { limited, TOO_MANY } from "@/lib/rate-limit";
import type { Json } from "@/lib/supabase/database.types";
import { stageAdd, stageBegin, stageFinish } from "@/lib/company/line-stage";
import { clearLedger } from "@/lib/company/ledger-lines";

const OVER_240 = "Saving more than 240 months at once needs the latest database update (migration 0035). Ask the site owner to run it.";

const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Line = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  period: Period,
  doc: z.string().max(80),
  series: z.string().max(40),
  supplier: z.string().max(200),
  account: z.string().max(200),
  cls: z.string().regex(/^[a-z_]{2,40}$/).nullable(),
  category: z.string().max(200),
  label: z.string().max(200),
  amount: z.number().finite(),
  // Simple mode only (migration 0036): paid or not, the day it was paid.
  paid: z.boolean().nullable().optional(),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
const Start = z.object({
  companyId: z.string().uuid(),
  source: z.enum(["ledger", "file"]),
  periods: z.array(Period).max(600),
  filename: z.string().max(300).optional(),
  report: z.record(z.string(), z.unknown()).optional(),
  /** Replace all: every month of this source goes first, not only the file's months. */
  all: z.boolean().optional(),
}).refine((d) => d.periods.length > 0 || d.all, { message: "Too small: expected array to have >=1 items", path: ["periods"] });

/**
 * Opens a save: this source's expense lines for these months are replaced by the lines added next, but only when the save
 * finishes (finishExpenseBatch). `staged` is false only on a database without the stage functions (migration 0035).
 */
export async function startExpenseBatch(input: z.input<typeof Start>): Promise<{ ok: true; batch: string; staged: boolean } | { ok: false; error: string }> {
  const v = Start.safeParse(input);
  if (!v.success) return { ok: false, error: "The expense data is not valid: " + v.error.issues[0]?.message };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (await limited(supabase, "expenses", user.id)) return { ok: false, error: TOO_MANY };
  try {
    const periods = [...new Set(v.data.periods)].sort();
    const st = await stageBegin(supabase, "expenses", { ...v.data, periods });
    if (st.ok) return { ok: true, batch: st.stage, staged: true };
    if (!st.missing) return st;
    // A database without 0035: replace all with nothing new clears the source's ledger lines directly.
    if (!periods.length) {
      if (v.data.source === "ledger") await clearLedger(supabase, v.data.companyId, "all", ["expenses"]);
      return { ok: true, batch: "", staged: false };
    }
    if (periods.length > 240) return { ok: false, error: OVER_240 };
    const { data, error } = await supabase.rpc("begin_expense_batch", {
      p_company: v.data.companyId, p_source: v.data.source, p_periods: periods, p_filename: v.data.filename, p_report: (v.data.report ?? {}) as Json,
      ...(v.data.all ? { p_all: true } : {}),
    });
    if (error) return { ok: false, error: dbError(error, "begin_expense_batch") };
    await dropEmpty(supabase, v.data.companyId, v.data.source, data as string, sameFile(v.data), periods);
    return { ok: true, batch: data as string, staged: false };
  } catch (e) {
    return { ok: false, error: safeError(e, "startExpenseBatch") };
  }
}

/** Adds up to 4,000 lines to an open save. */
export async function addExpenseLines(companyId: string, batch: string, lines: z.input<typeof Line>[], last: boolean, staged = false): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  const ids = z.object({ companyId: z.string().uuid(), batch: z.string().uuid() }).safeParse({ companyId, batch });
  const ls = z.array(Line).min(1).max(4000).safeParse(lines);
  if (!ids.success) return { ok: false, error: "The expense lines are not valid." };
  if (!ls.success) return { ok: false, error: zodProblem(ls.error, "expense line") };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  try {
    if (staged) return await stageAdd(supabase, batch, ls.data);
    const { data, error } = await supabase.rpc("add_expense_lines", { p_batch: batch, p_lines: ls.data as unknown as Json });
    if (error) return { ok: false, error: dbError(error, "add_expense_lines") };
    if (last) revalidatePath(`/company/${companyId}`, "layout");
    return { ok: true, saved: data as number };
  } catch (e) {
    return { ok: false, error: safeError(e, "addExpenseLines") };
  }
}

/** Finishes a staged save: the months are replaced and every line added in one step. */
export async function finishExpenseBatch(input: z.input<typeof Start>, stage: string): Promise<{ ok: true; saved: number; sent: number } | { ok: false; error: string }> {
  const v = Start.safeParse(input);
  if (!v.success || !z.string().uuid().safeParse(stage).success) return { ok: false, error: "The expense data is not valid." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  try {
    const f = await stageFinish(supabase, stage);
    if (!f.ok) return f;
    if (f.batch) await dropEmpty(supabase, v.data.companyId, v.data.source, f.batch, sameFile(v.data), [...new Set(v.data.periods)].sort());
    revalidatePath(`/company/${v.data.companyId}`, "layout");
    return { ok: true, saved: f.saved, sent: f.sent };
  } catch (e) {
    return { ok: false, error: safeError(e, "finishExpenseBatch") };
  }
}

/** A file saved again in place of its earlier upload ("replace", or saved as new), never "add only new months". */
const sameFile = (d: { source: "ledger" | "file"; filename?: string; report?: Record<string, unknown> }) =>
  d.source === "file" && d.filename && !["add", "new", "changed"].includes(String(d.report?.mode)) ? d.filename.slice(0, 300) : null;

/**
 * Uploads left with no lines (every month replaced by a later upload) are removed, so Data health lists only uploads
 * that still count. Best effort: a failure here never stops the upload.
 */
async function dropEmpty(supabase: Awaited<ReturnType<typeof getUser>>["supabase"], companyId: string, source: "ledger" | "file", keep: string, file: string | null = null, periods: string[] = []) {
  try {
    // The same file uploaded again (replacing what it gave before): its earlier lines go entirely, not only the months
    // the new upload holds, so an entry that moved month is never left behind in its old one.
    if (file) {
      // Only an earlier upload of that name that overlaps these months is the same file: last year's file of the same
      // name (other months) is kept.
      const { data: same } = await supabase.from("expense_batches").select("id, periods").eq("company_id", companyId).eq("source", "file").eq("filename", file).neq("id", keep);
      const ids = (same ?? []).filter((b) => ((b.periods as string[] | null) ?? []).some((p) => periods.includes(p))).map((b) => b.id);
      if (ids.length) await supabase.from("expense_lines").delete().eq("company_id", companyId).in("batch_id", ids);
    }
    const { data } = await supabase.from("expense_batches").select("id, lines:expense_lines(count)").eq("company_id", companyId).eq("source", source).neq("id", keep);
    const empty = ((data ?? []) as unknown as { id: string; lines: { count: number }[] }[]).filter((b) => !(b.lines?.[0]?.count ?? 0)).map((b) => b.id);
    if (empty.length) await supabase.from("expense_batches").delete().in("id", empty);
  } catch { /* the upload itself is what matters */ }
}

/** Each loaded month of this source: line count and fingerprint, for "Add new and changed". Null: the database has no
 *  line_months yet (migration 0021 not applied), and the caller replaces the file's months instead. */
export async function expenseLineMonths(companyId: string, source: "ledger" | "file"): Promise<{ ok: true; months: Record<string, { n: number; print: string }> | null } | { ok: false; error: string }> {
  if (!z.string().uuid().safeParse(companyId).success) return { ok: false, error: "Invalid company" };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const { data, error } = await supabase.rpc("line_months", { p_company: companyId, p_kind: "expenses", p_source: source });
  if (error) return error.code === "PGRST202" ? { ok: true, months: null } : { ok: false, error: dbError(error, "line_months") };
  return { ok: true, months: (data ?? {}) as Record<string, { n: number; print: string }> };
}

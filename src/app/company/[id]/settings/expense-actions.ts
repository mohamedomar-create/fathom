"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { dbError, safeError } from "@/lib/action-error";
import { limited, TOO_MANY } from "@/lib/rate-limit";
import type { Json } from "@/lib/supabase/database.types";

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
});
const Start = z.object({
  companyId: z.string().uuid(),
  source: z.enum(["ledger", "file"]),
  periods: z.array(Period).min(1).max(240),
  filename: z.string().max(300).optional(),
  report: z.record(z.string(), z.unknown()).optional(),
});

/** Opens a batch: this source's expense lines for these months are replaced by the lines added next. */
export async function startExpenseBatch(input: z.input<typeof Start>): Promise<{ ok: true; batch: string } | { ok: false; error: string }> {
  const v = Start.safeParse(input);
  if (!v.success) return { ok: false, error: "The expense data is not valid: " + v.error.issues[0]?.message };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (await limited(supabase, `expenses:${user.id}`, 3600, 60)) return { ok: false, error: TOO_MANY };
  try {
    const periods = [...new Set(v.data.periods)].sort();
    const { data, error } = await supabase.rpc("begin_expense_batch", {
      p_company: v.data.companyId, p_source: v.data.source, p_periods: periods, p_filename: v.data.filename, p_report: (v.data.report ?? {}) as Json,
    });
    if (!error) return { ok: true, batch: data as string };
    // A database without the function (its update not yet applied) does the same steps through the table rules,
    // which let only the company's editors delete and add its expense lines.
    if (error.code !== "PGRST202") return { ok: false, error: dbError(error, "begin_expense_batch") };
    const del = await supabase.from("expense_lines").delete().eq("company_id", v.data.companyId).eq("source", v.data.source).in("period", periods);
    if (del.error) return { ok: false, error: dbError(del.error, "expense_lines delete") };
    const ins = await supabase.from("expense_batches").insert({ company_id: v.data.companyId, source: v.data.source, periods, filename: v.data.filename?.slice(0, 300) ?? null, report: (v.data.report ?? {}) as Json, created_by: user.id }).select("id").single();
    if (ins.error) return { ok: false, error: dbError(ins.error, "expense_batches insert") };
    return { ok: true, batch: ins.data.id };
  } catch (e) {
    return { ok: false, error: safeError(e, "startExpenseBatch") };
  }
}

/** Adds up to 4,000 lines to an open batch. */
export async function addExpenseLines(companyId: string, batch: string, lines: z.input<typeof Line>[], last: boolean): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  const ids = z.object({ companyId: z.string().uuid(), batch: z.string().uuid() }).safeParse({ companyId, batch });
  const ls = z.array(Line).min(1).max(4000).safeParse(lines);
  if (!ids.success || !ls.success) return { ok: false, error: "The expense lines are not valid." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  try {
    const { data, error } = await supabase.rpc("add_expense_lines", { p_batch: batch, p_lines: ls.data as unknown as Json });
    if (error) {
      if (error.code !== "PGRST202") return { ok: false, error: dbError(error, "add_expense_lines") };
      // Without the function: the batch's months, then the lines through the table rules.
      const b = await supabase.from("expense_batches").select("company_id, source, periods").eq("id", batch).single();
      if (b.error || b.data.company_id !== companyId) return { ok: false, error: "The expense batch was not found." };
      const rows = ls.data.filter((l) => b.data.periods.includes(l.period)).map((l) => ({ ...l, company_id: companyId, batch_id: batch, source: b.data.source }));
      const ins = await supabase.from("expense_lines").insert(rows);
      if (ins.error) return { ok: false, error: dbError(ins.error, "expense_lines insert") };
      if (last) revalidatePath(`/company/${companyId}`, "layout");
      return { ok: true, saved: rows.length };
    }
    if (last) revalidatePath(`/company/${companyId}`, "layout");
    return { ok: true, saved: data as number };
  } catch (e) {
    return { ok: false, error: safeError(e, "addExpenseLines") };
  }
}

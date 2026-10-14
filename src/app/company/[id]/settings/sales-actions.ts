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
  customer: z.string().max(200),
  product: z.string().max(300),
  category: z.string().max(200),
  salesperson: z.string().max(120),
  qty: z.number().finite().nullable(),
  amount: z.number().finite(),
  cost: z.number().finite().nullable(),
});
const Start = z.object({
  companyId: z.string().uuid(),
  source: z.enum(["ledger", "file"]),
  periods: z.array(Period).min(1).max(240),
  filename: z.string().max(300).optional(),
  report: z.record(z.string(), z.unknown()).optional(),
});

/** Opens a batch: this source's sales for these months are replaced by the lines added next. */
export async function startSalesBatch(input: z.input<typeof Start>): Promise<{ ok: true; batch: string } | { ok: false; error: string }> {
  const v = Start.safeParse(input);
  if (!v.success) return { ok: false, error: "The sales data is not valid: " + v.error.issues[0]?.message };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (await limited(supabase, `sales:${user.id}`, 3600, 60)) return { ok: false, error: TOO_MANY };
  try {
    const periods = [...new Set(v.data.periods)].sort();
    const { data, error } = await supabase.rpc("begin_sales_batch", {
      p_company: v.data.companyId, p_source: v.data.source, p_periods: periods, p_filename: v.data.filename, p_report: (v.data.report ?? {}) as Json,
    });
    if (!error) { await dropEmpty(supabase, v.data.companyId, v.data.source, data as string); return { ok: true, batch: data as string }; }
    // A database without the function (its update not yet applied) does the same steps through the table rules,
    // which let only the company's editors delete and add its sales.
    if (error.code !== "PGRST202") return { ok: false, error: dbError(error, "begin_sales_batch") };
    const del = await supabase.from("sales_lines").delete().eq("company_id", v.data.companyId).eq("source", v.data.source).in("period", periods);
    if (del.error) return { ok: false, error: dbError(del.error, "sales_lines delete") };
    const ins = await supabase.from("sales_batches").insert({ company_id: v.data.companyId, source: v.data.source, periods, filename: v.data.filename?.slice(0, 300) ?? null, report: (v.data.report ?? {}) as Json, created_by: user.id }).select("id").single();
    if (ins.error) return { ok: false, error: dbError(ins.error, "sales_batches insert") };
    await dropEmpty(supabase, v.data.companyId, v.data.source, ins.data.id);
    return { ok: true, batch: ins.data.id };
  } catch (e) {
    return { ok: false, error: safeError(e, "startSalesBatch") };
  }
}

/** Adds up to 4,000 lines to an open batch. */
export async function addSalesLines(companyId: string, batch: string, lines: z.input<typeof Line>[], last: boolean): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  const ids = z.object({ companyId: z.string().uuid(), batch: z.string().uuid() }).safeParse({ companyId, batch });
  const ls = z.array(Line).min(1).max(4000).safeParse(lines);
  if (!ids.success || !ls.success) return { ok: false, error: "The sales lines are not valid." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  try {
    const { data, error } = await supabase.rpc("add_sales_lines", { p_batch: batch, p_lines: ls.data as unknown as Json });
    if (error) return { ok: false, error: dbError(error, "add_sales_lines") };
    if (last) revalidatePath(`/company/${companyId}`, "layout");
    return { ok: true, saved: data as number };
  } catch (e) {
    return { ok: false, error: safeError(e, "addSalesLines") };
  }
}

/**
 * Uploads left with no lines (every month replaced by a later upload) are removed, so Data health lists only uploads
 * that still count. Best effort: a failure here never stops the upload.
 */
async function dropEmpty(supabase: Awaited<ReturnType<typeof getUser>>["supabase"], companyId: string, source: "ledger" | "file", keep: string) {
  try {
    const { data } = await supabase.from("sales_batches").select("id, lines:sales_lines(count)").eq("company_id", companyId).eq("source", source).neq("id", keep);
    const empty = ((data ?? []) as unknown as { id: string; lines: { count: number }[] }[]).filter((b) => !(b.lines?.[0]?.count ?? 0)).map((b) => b.id);
    if (empty.length) await supabase.from("sales_batches").delete().in("id", empty);
  } catch { /* the upload itself is what matters */ }
}

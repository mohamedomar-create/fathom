"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { dbError, safeError } from "@/lib/action-error";
import { limited, TOO_MANY } from "@/lib/rate-limit";
import type { Json } from "@/lib/supabase/database.types";

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

/** Opens a payments batch: the company's payments for these months are replaced by the lines added next. */
export async function startPaymentBatch(companyId: string, periods: string[], filename: string): Promise<{ ok: true; batch: string } | { ok: false; error: string }> {
  const v = z.object({ companyId: z.string().uuid(), periods: z.array(Period).min(1).max(240), filename: z.string().max(300) }).safeParse({ companyId, periods, filename });
  if (!v.success) return { ok: false, error: "The payments are not valid: " + v.error.issues[0]?.message };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (await limited(supabase, "payments", user.id)) return { ok: false, error: TOO_MANY };
  try {
    const { data, error } = await supabase.rpc("begin_payment_batch", { p_company: companyId, p_periods: [...new Set(periods)].sort(), p_filename: filename, p_report: {} as Json });
    if (error) return { ok: false, error: dbError(error, "begin_payment_batch") };
    return { ok: true, batch: data as string };
  } catch (e) {
    return { ok: false, error: safeError(e, "startPaymentBatch") };
  }
}

/** Adds up to 4,000 payments to an open batch. */
export async function addPaymentLines(companyId: string, batch: string, lines: z.input<typeof Line>[], last: boolean): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  const ids = z.object({ companyId: z.string().uuid(), batch: z.string().uuid() }).safeParse({ companyId, batch });
  const ls = z.array(Line).min(1).max(4000).safeParse(lines);
  if (!ids.success || !ls.success) return { ok: false, error: "The payments are not valid." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  try {
    const { data, error } = await supabase.rpc("add_payment_lines", { p_batch: batch, p_lines: ls.data as unknown as Json });
    if (error) return { ok: false, error: dbError(error, "add_payment_lines") };
    if (last) revalidatePath(`/company/${companyId}`, "layout");
    return { ok: true, saved: data as number };
  } catch (e) {
    return { ok: false, error: safeError(e, "addPaymentLines") };
  }
}

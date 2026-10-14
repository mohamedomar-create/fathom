"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { safeError } from "@/lib/action-error";
import { clearLedger } from "@/lib/company/ledger-lines";

const Input = z.object({ companyId: z.string().uuid(), periods: z.union([z.literal("all"), z.array(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)).max(600)]) });

/**
 * Before an accounts import saves its months: the sales and expense lines that came from the General Ledger for those
 * months (or all months, when everything is replaced) are removed, so they never outlive the accounts they came from.
 */
export async function clearLedgerLines(companyId: string, periods: string[] | "all"): Promise<{ ok: true } | { ok: false; error: string }> {
  const v = Input.safeParse({ companyId, periods });
  if (!v.success) return { ok: false, error: "Invalid request." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  try {
    await clearLedger(supabase, v.data.companyId, v.data.periods);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: safeError(e, "clearLedgerLines") };
  }
}

const Remove = z.object({ companyId: z.string().uuid(), kind: z.enum(["sales", "expenses"]), batchId: z.string().uuid() });
/** Removes one uploaded sales or expenses file: its batch and every line it added (Data health). */
export async function removeLineUpload(companyId: string, kind: "sales" | "expenses", batchId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const v = Remove.safeParse({ companyId, kind, batchId });
  if (!v.success) return { ok: false, error: "Invalid request." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const { data, error } = await supabase.from(kind === "sales" ? "sales_batches" : "expense_batches").delete().eq("id", batchId).eq("company_id", companyId).select("id");
  if (error) return { ok: false, error: safeError(error, "removeLineUpload") };
  if (!data?.length) return { ok: false, error: "Only editors can remove uploads." };
  // Earlier uploads whose months a later file replaced hold no lines any more: they go too, so nothing empty comes back.
  const t = kind === "sales" ? { b: "sales_batches", l: "sales_lines" } as const : { b: "expense_batches", l: "expense_lines" } as const;
  const { data: rest } = await supabase.from(t.b).select("id").eq("company_id", companyId).eq("source", "file");
  for (const b of rest ?? []) {
    const { count } = await supabase.from(t.l).select("id", { count: "exact", head: true }).eq("batch_id", b.id);
    if (count === 0) await supabase.from(t.b).delete().eq("id", b.id);
  }
  revalidatePath(`/company/${companyId}`, "layout");
  return { ok: true };
}

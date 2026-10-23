"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { safeError } from "@/lib/action-error";
import { clearLedger, type LedgerKind } from "@/lib/company/ledger-lines";

const Input = z.object({ companyId: z.string().uuid(), periods: z.union([z.literal("all"), z.array(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)).max(600)]) });

/**
 * Before an accounts import saves its months: the sales and expense lines that came from the General Ledger for those
 * months (or all months, when everything is replaced) are removed, so they never outlive the accounts they came from.
 */
export async function clearLedgerLines(companyId: string, periods: string[] | "all", kinds?: LedgerKind[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const v = Input.safeParse({ companyId, periods });
  if (!v.success) return { ok: false, error: "Invalid request." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  // Row security would quietly delete nothing for a viewer; say so instead of reporting success.
  const { data: co } = await supabase.from("companies").select("org_id").eq("id", v.data.companyId).maybeSingle();
  const { data: mem } = co ? await supabase.from("memberships").select("role").eq("org_id", co.org_id).eq("user_id", user.id).maybeSingle() : { data: null };
  if (!mem || mem.role === "viewer") return { ok: false, error: "Only an editor or admin of this company can do that." };
  try {
    await clearLedger(supabase, v.data.companyId, v.data.periods, kinds?.filter((k) => ["sales", "expenses", "stock"].includes(k)));
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

const Discard = z.object({ companyId: z.string().uuid(), kind: z.enum(["sales", "expenses", "payments"]), batchId: z.string().uuid() });
/** Removes an upload opened for a save that ended with no lines (databases without staging, migration 0035). */
export async function discardEmptyBatch(companyId: string, kind: "sales" | "expenses" | "payments", batchId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const v = Discard.safeParse({ companyId, kind, batchId });
  if (!v.success) return { ok: false, error: "Invalid request." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const t = { sales: ["sales_batches", "sales_lines"], expenses: ["expense_batches", "expense_lines"], payments: ["payment_batches", "payment_lines"] } as const;
  // payment tables are not in the generated types; the calls are the same shape.
  const [batches, lines] = t[v.data.kind];
  const { count, error: countError } = await supabase.from(lines as "sales_lines").select("id", { count: "exact", head: true }).eq("batch_id", v.data.batchId);
  if (countError) return { ok: false, error: safeError(countError, "discardEmptyBatch") };
  if (count) return { ok: true };
  const { error } = await supabase.from(batches as "sales_batches").delete().eq("id", v.data.batchId).eq("company_id", v.data.companyId);
  if (error) return { ok: false, error: safeError(error, "discardEmptyBatch") };
  revalidatePath(`/company/${v.data.companyId}`, "layout");
  return { ok: true };
}

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

"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { patchSettings } from "@/lib/company/settings-patch";
import { HIGHLIGHTS_KEY } from "@/lib/company/config-keys";
import { MARK_COLORS, markKeyOk } from "@/lib/engine/statement-rows";
import { dbError } from "@/lib/action-error";

const MarkSchema = z.object({ color: z.enum(MARK_COLORS), note: z.string().trim().max(120).optional() }).strict();
const KeySchema = z.string().refine(markKeyOk);

/** An editor's colour mark on one statement line or account (null clears it). Everyone in the company sees it. */
export async function setStatementMark(companyId: string, key: string, mark: z.input<typeof MarkSchema> | null): Promise<{ ok: boolean; error?: string }> {
  const parsed = MarkSchema.nullable().safeParse(mark);
  if (!z.string().uuid().safeParse(companyId).success || !KeySchema.safeParse(key).success || !parsed.success) return { ok: false, error: "Invalid mark." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const m = parsed.data && (parsed.data.note ? parsed.data : { color: parsed.data.color });
  const { error } = await supabase.rpc("set_statement_mark", { p_company: companyId, p_key: key, p_mark: m });
  if (error) return { ok: false, error: error.code === "42501" ? "You do not have permission to change this." : dbError(error, "setStatementMark") };
  revalidatePath(`/company/${companyId}`, "layout");
  return { ok: true };
}

/** When a line is flagged: a move of at least pct percent AND at least amount in the company's currency. */
export async function saveHighlightThresholds(companyId: string, pct: number, amount: number): Promise<{ ok: boolean; error?: string }> {
  const ok = z.object({ pct: z.number().finite().positive().max(1000), amount: z.number().finite().positive().max(1e12) }).safeParse({ pct, amount });
  if (!z.string().uuid().safeParse(companyId).success || !ok.success) return { ok: false, error: "Enter a percentage and an amount above zero." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const r = await patchSettings(supabase, companyId, { [HIGHLIGHTS_KEY]: { pct, amount } });
  if (!r.ok) return r;
  revalidatePath(`/company/${companyId}`, "layout");
  return { ok: true };
}

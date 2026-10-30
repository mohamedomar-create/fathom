"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRecentSignIn } from "@/lib/auth/require-recent";
import { getUser } from "@/lib/supabase/server";
import { dbError } from "@/lib/action-error";

const Id = z.string().uuid();
const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/**
 * Closes the books up to and including `month`, or reopens from `month` on (the books stay closed up to the month before).
 * Only the owner or an admin, with two-step sign-in and a fresh sign-in; the database checks all of it and records it.
 */
export async function setMonthClosed(companyId: string, month: string, close: boolean): Promise<{ ok: true; closedThrough: string } | { ok: false; error: string }> {
  if (!Id.safeParse(companyId).success || !Month.safeParse(month).success) return { ok: false, error: "That value isn't valid." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  { const stale = await requireRecentSignIn(supabase); if (stale) return { ok: false, error: stale }; }
  const { data, error } = await supabase.rpc(close ? "close_month" : "reopen_month", { p_company: companyId, p_month: month });
  if (error) return { ok: false, error: dbError(error, close ? "close_month" : "reopen_month") };
  revalidatePath(`/company/${companyId}`, "layout");
  return { ok: true, closedThrough: data as string };
}

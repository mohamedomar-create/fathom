"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { dbError } from "@/lib/action-error";
import { BUSY, checkLimit, TOO_MANY } from "@/lib/rate-limit";

type Result = { ok: true } | { ok: false; error: string };
const Accept = z.object({ company: z.string().uuid(), key: z.string().min(1).max(400), title: z.string().max(300), reason: z.string().trim().min(3).max(500), amount: z.number().finite().nullable() });
const Undo = z.object({ company: z.string().uuid(), id: z.string().uuid() });

async function begin() {
  const { supabase, user } = await getUser();
  if (!user) return { error: "Please sign in again." } as const;
  const lim = await checkLimit(supabase, "doctor", user.id);
  if (lim === "over") return { error: TOO_MANY } as const;
  if (lim === "error") return { error: BUSY } as const;
  return { supabase } as const;
}

/** Accepts a finding with a reason (editors only; the database checks the role). */
export async function acceptFinding(company: string, key: string, title: string, reason: string, amount: number | null): Promise<Result> {
  const p = Accept.safeParse({ company, key, title: title.slice(0, 300), reason, amount });
  if (!p.success) return { ok: false, error: p.error.issues.some((i) => i.path[0] === "reason") ? "Give a reason of at least 3 characters (500 at most)." : "That finding can't be accepted. Reload the page and try again." };
  const s = await begin();
  if ("error" in s) return { ok: false, error: s.error! };
  const { error } = await s.supabase.rpc("doctor_accept", { p_company: p.data.company, p_key: p.data.key, p_title: p.data.title, p_reason: p.data.reason, p_amount: p.data.amount });
  if (error) return { ok: false, error: dbError(error, "doctor_accept") };
  revalidatePath(`/company/${company}/doctor`);
  return { ok: true };
}

/** Undoes an acceptance (within 30 days; editors only). */
export async function undoFinding(company: string, id: string): Promise<Result> {
  const p = Undo.safeParse({ company, id });
  if (!p.success) return { ok: false, error: "That value isn't valid." };
  const s = await begin();
  if ("error" in s) return { ok: false, error: s.error! };
  const { error } = await s.supabase.rpc("doctor_undo", { p_company: p.data.company, p_id: p.data.id });
  if (error) return { ok: false, error: dbError(error, "doctor_undo") };
  revalidatePath(`/company/${company}/doctor`);
  return { ok: true };
}

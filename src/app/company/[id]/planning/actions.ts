"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { dbError } from "@/lib/action-error";
import { BUSY, checkLimit, TOO_MANY } from "@/lib/rate-limit";
import { cleanPlan, newPlanId, PlanError, type BusinessPlan } from "@/lib/engine/plan";

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
const Id = z.string().uuid();
const PlanId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);

async function begin() {
  const { supabase, user } = await getUser();
  if (!user) return { error: "Please sign in again." } as const;
  const lim = await checkLimit(supabase, "plan", user.id);
  if (lim === "over") return { error: TOO_MANY } as const;
  if (lim === "error") return { error: BUSY } as const;
  return { supabase, user } as const;
}

/** The plan as the browser sent it, checked by the same gate the engine uses (every number in range, names short). */
function clean(input: unknown): { ok: true; plan: ReturnType<typeof cleanPlan> } | { ok: false; error: string } {
  try { return { ok: true, plan: cleanPlan(input) }; } catch (e) { return { ok: false, error: e instanceof PlanError ? e.message : "The business plan isn't valid." }; }
}

export async function createPlan(companyId: string, input: unknown): Promise<Result<BusinessPlan>> {
  if (!Id.safeParse(companyId).success) return { ok: false, error: "That value isn't valid." };
  const c = clean(input);
  if (!c.ok) return c;
  const s = await begin();
  if ("error" in s) return { ok: false, error: s.error! };
  const id = newPlanId();
  const { data, error } = await s.supabase.rpc("plan_create", { p_company: companyId, p_id: id, p_data: c.plan as never });
  if (error) return { ok: false, error: dbError(error, "plan_create") };
  revalidatePath(`/company/${companyId}/planning`);
  return { ok: true, data: { ...c.plan, id, createdBy: s.user.id, updatedAt: String(data) } };
}

/** Saves the plan if nobody saved it since `expected` (the version it was edited from); returns the new version. */
export async function savePlan(companyId: string, id: string, input: unknown, expected: string | null): Promise<Result<string>> {
  if (!Id.safeParse(companyId).success || !PlanId.safeParse(id).success) return { ok: false, error: "That value isn't valid." };
  const c = clean(input);
  if (!c.ok) return c;
  const s = await begin();
  if ("error" in s) return { ok: false, error: s.error! };
  const { data, error } = await s.supabase.rpc("plan_save", { p_company: companyId, p_id: id, p_data: c.plan as never, p_expected: expected || null });
  if (error?.hint === "stale_plan") return { ok: false, error: "This plan was changed in another tab or by someone else. Reload the page to get the latest version." };
  if (error) return { ok: false, error: dbError(error, "plan_save") };
  return { ok: true, data: String(data) };
}

export async function deletePlan(companyId: string, id: string): Promise<Result> {
  if (!Id.safeParse(companyId).success || !PlanId.safeParse(id).success) return { ok: false, error: "That value isn't valid." };
  const s = await begin();
  if ("error" in s) return { ok: false, error: s.error! };
  const { error } = await s.supabase.rpc("plan_delete", { p_company: companyId, p_id: id });
  if (error) return { ok: false, error: dbError(error, "plan_delete") };
  revalidatePath(`/company/${companyId}/planning`);
  return { ok: true, data: undefined };
}

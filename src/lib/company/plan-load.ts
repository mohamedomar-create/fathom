import "server-only";
import type { getUser } from "@/lib/supabase/server";
import { cleanPlan, type BusinessPlan } from "@/lib/engine/plan";

type Supa = Awaited<ReturnType<typeof getUser>>["supabase"];

/** The company's business plans, oldest first, each checked as the app reads it (a bad stored value never breaks the page). */
export async function loadPlans(supabase: Supa, companyId: string): Promise<{ plans: BusinessPlan[]; error?: string }> {
  const { data, error } = await supabase.from("business_plans").select("id, data, created_by, created_at, updated_at").eq("company_id", companyId).order("created_at");
  if (error) return { plans: [], error: error.code === "42P01" || error.code === "PGRST205" ? "missing" : "failed" };
  const plans: BusinessPlan[] = [];
  for (const r of data ?? []) {
    try { plans.push({ ...cleanPlan(r.data), id: r.id, createdBy: r.created_by ?? "", updatedAt: r.updated_at }); } catch { /* a plan that no longer passes the checks is left out */ }
  }
  return { plans };
}

import { fetchAllPages } from "./paged";
import type { getUser } from "@/lib/supabase/server";

type Supa = Awaited<ReturnType<typeof getUser>>["supabase"];
export interface BalanceRow { account_id: string; period: string; amount: number; import_id: string | null }

/** The function is not in the database yet (migration 0026 not applied). */
const missing = (e: { code?: string }) => e.code === "PGRST202" || e.code === "42883";

/**
 * Every balance of one data version, in one call (company_balances checks membership once). Before migration 0026, the
 * table is read in 1,000-row pages, which runs the row security check on every row.
 */
export async function loadBalances(supabase: Supa, companyId: string, version: number): Promise<BalanceRow[]> {
  const { data, error } = await supabase.rpc("company_balances", { p_company: companyId, p_version: version });
  if (!error) return ((data ?? []) as unknown as [string, string, number | string, string | null][]).map(([account_id, period, amount, import_id]) => ({ account_id, period, amount: Number(amount), import_id }));
  if (!missing(error)) throw error;
  return fetchAllPages(async (from, to, withCount) => {
    const { data: rows, error: e2, count } = await supabase.from("account_balances")
      .select("account_id, period, amount, import_id, source_accounts!inner(version)", withCount ? { count: "exact" } : undefined)
      .eq("company_id", companyId).eq("source_accounts.version", version)
      .order("account_id").order("period").range(from, to);
    if (e2) throw e2;
    return { rows: (rows ?? []).map((r) => ({ account_id: r.account_id, period: r.period, amount: Number(r.amount), import_id: r.import_id })), count: count ?? null };
  });
}

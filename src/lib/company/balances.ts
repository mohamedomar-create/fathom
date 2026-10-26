import type { getUser } from "@/lib/supabase/server";

type Supa = Awaited<ReturnType<typeof getUser>>["supabase"];
export interface BalanceRow { account_id: string; period: string; amount: number; import_id: string | null }

/** Every balance of one data version, in one call (company_balances checks membership once). */
export async function loadBalances(supabase: Supa, companyId: string, version: number): Promise<BalanceRow[]> {
  const { data, error } = await supabase.rpc("company_balances", { p_company: companyId, p_version: version });
  if (!error) return ((data ?? []) as unknown as [string, string, number | string, string | null][]).map(([account_id, period, amount, import_id]) => ({ account_id, period, amount: Number(amount), import_id }));
  throw error;
}

import "server-only";
import { getUser } from "@/lib/supabase/server";
import { loadSales } from "@/lib/company/sales-load";
import { valuationSettingsOf } from "./settings";
import { topShare } from "./inputs";
import type { ValuationSettings } from "@/lib/engine/valuation";

export interface ValuationPageData { settings: ValuationSettings; topCustomerShare: number | null; customersRead: boolean }

/** The saved valuation choices and the largest customer's share of the last twelve months' sales (read on the server). */
export async function loadValuationPage(companyId: string, start: string | null, end: string | null): Promise<ValuationPageData> {
  const { supabase } = await getUser();
  const [{ data: row }, sales] = await Promise.all([
    supabase.from("companies").select("kpi_config").eq("id", companyId).maybeSingle(),
    loadSales(companyId),
  ]);
  const ok = sales.status === "ready" || sales.status === "stale";
  const topCustomerShare = ok && start && end ? topShare(sales.data, start, end) : null;
  return { settings: valuationSettingsOf(row?.kpi_config ?? null), topCustomerShare, customersRead: ok };
}

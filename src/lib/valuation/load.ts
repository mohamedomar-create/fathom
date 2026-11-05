import "server-only";
import { getUser } from "@/lib/supabase/server";
import { loadSales } from "@/lib/company/sales-load";
import { valuationSettingsOf } from "./settings";
import type { ValuationSettings } from "@/lib/engine/valuation";

export interface ValuationPageData { settings: ValuationSettings; topCustomerShare: number | null; customersRead: boolean }

/** The saved valuation choices and the largest customer's share of the last twelve months' sales (read on the server). */
export async function loadValuationPage(companyId: string, start: string | null, end: string | null): Promise<ValuationPageData> {
  const { supabase } = await getUser();
  const [{ data: row }, sales] = await Promise.all([
    supabase.from("companies").select("kpi_config").eq("id", companyId).maybeSingle(),
    loadSales(companyId),
  ]);
  let topCustomerShare: number | null = null;
  const ok = sales.status === "ready" || sales.status === "stale";
  if (ok && start && end) {
    const by = new Map<string, number>();
    for (const r of sales.data.customers) if (r.p >= start && r.p <= end && r.a > 0) by.set(r.c, (by.get(r.c) ?? 0) + r.a);
    const total = [...by.values()].reduce((s, v) => s + v, 0);
    if (total > 0) topCustomerShare = Math.max(...by.values()) / total;
  }
  return { settings: valuationSettingsOf(row?.kpi_config ?? null), topCustomerShare, customersRead: ok };
}

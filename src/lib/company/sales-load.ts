import "server-only";
import { cache } from "react";
import { EMPTY_SALES, type SalesData } from "@/lib/engine";
import { parseSalesSummary } from "./sales-parse";
import { getUser } from "@/lib/supabase/server";
import { summaryStamps } from "./meta";
import { remember } from "./summary-cache";

/** The company's sales, added up by customer and by product per month (row-level security applies). */
export const loadSales = cache(async (companyId: string): Promise<SalesData> => {
  const { supabase } = await getUser();
  // Kept between visits while nothing it is built from changed (the stamp checks the person's membership first).
  const stamp = (await summaryStamps(companyId))["sales"];
  const { data, error } = await remember("sales", companyId, stamp, async () => {
    const r = await supabase.rpc("sales_summary", { p_company: companyId });
    if (r.error) throw r.error;
    return r;
  }).catch((e: { message: string; code?: string }) => ({ data: null, error: e }));
  if (error) { console.error("sales_summary", error.message); return EMPTY_SALES; }
  return parseSalesSummary(data);
});

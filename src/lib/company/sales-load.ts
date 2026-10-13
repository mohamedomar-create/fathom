import "server-only";
import { cache } from "react";
import { EMPTY_SALES, type SalesData } from "@/lib/engine";
import { parseSalesSummary } from "./sales-parse";
import { getUser } from "@/lib/supabase/server";

/** The company's sales, added up by customer and by product per month (row-level security applies). */
export const loadSales = cache(async (companyId: string): Promise<SalesData> => {
  const { supabase } = await getUser();
  const { data, error } = await supabase.rpc("sales_summary", { p_company: companyId });
  if (error) { console.error("sales_summary", error.message); return EMPTY_SALES; }
  return parseSalesSummary(data);
});

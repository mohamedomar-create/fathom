import "server-only";
import { cache } from "react";
import { EMPTY_INVENTORY, type InventoryData } from "@/lib/engine/inventory";
import { parseInventorySummary } from "./inventory-parse";
import { getUser } from "@/lib/supabase/server";

/** The company's stock records, added up by month, product, kind and location (empty before the Inventory update). */
export const loadInventory = cache(async (companyId: string): Promise<InventoryData> => {
  const { supabase } = await getUser();
  const { data, error } = await supabase.rpc("inventory_summary", { p_company: companyId });
  if (error) { if (error.code !== "PGRST202") console.error("inventory_summary", error.message); return EMPTY_INVENTORY; }
  return parseInventorySummary(data);
});

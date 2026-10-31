import "server-only";
import { cache } from "react";
import { inventoryStateFrom, NO_INVENTORY_STATE, type InventoryState } from "./inventory-wire";
import { getUser } from "@/lib/supabase/server";

/**
 * The company's stock summary, kept ready by the database (it is rebuilt in the background whenever stock records change),
 * so a page reads one small row instead of adding up every record. Empty before the Inventory update.
 */
export const loadInventory = cache(async (companyId: string): Promise<InventoryState> => {
  const { supabase } = await getUser();
  const { data, error } = await (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>)("inventory_state", { p_company: companyId });
  if (error) {
    if (error.code === "PGRST202") return { ...NO_INVENTORY_STATE, error: "UPDATE_NEEDED" };
    console.error("inventory_state", error.message);
    return { ...NO_INVENTORY_STATE, error: "LOAD_FAILED" };
  }
  return inventoryStateFrom(data);
});

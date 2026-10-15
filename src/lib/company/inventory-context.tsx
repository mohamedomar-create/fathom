"use client";
import { createContext, useContext } from "react";
import { EMPTY_INVENTORY, type InventoryData } from "@/lib/engine/inventory";

const Ctx = createContext<InventoryData>(EMPTY_INVENTORY);

/** The company's stock summary for the Inventory pages (loaded once by the sector's layout). */
export function InventoryProvider({ value, children }: { value: InventoryData; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useInventory = () => useContext(Ctx);

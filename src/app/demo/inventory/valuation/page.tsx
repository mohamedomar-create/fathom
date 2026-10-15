import type { Metadata } from "next";
import { InventoryValuation } from "@/components/inventory/inventory-valuation";
export const metadata: Metadata = { title: "Valuation and Checks" };
export default function Page() { return <InventoryValuation />; }

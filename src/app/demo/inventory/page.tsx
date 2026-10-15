import type { Metadata } from "next";
import { InventoryOverview } from "@/components/inventory/inventory-overview";
export const metadata: Metadata = { title: "Inventory Overview" };
export default function Page() { return <InventoryOverview />; }

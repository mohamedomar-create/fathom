import type { Metadata } from "next";
import { InventoryMovements } from "@/components/inventory/inventory-movements";
export const metadata: Metadata = { title: "Stock Movements" };
export default function Page() { return <InventoryMovements />; }

import type { Metadata } from "next";
import { InventoryProducts } from "@/components/inventory/inventory-products";
export const metadata: Metadata = { title: "Stock by Product" };
export default function Page() { return <InventoryProducts />; }

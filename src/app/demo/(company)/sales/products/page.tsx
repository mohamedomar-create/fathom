import type { Metadata } from "next";
import { SalesProducts } from "@/components/sales/sales-products";
export const metadata: Metadata = { title: "Products and Categories" };
export default function Page() { return <SalesProducts />; }

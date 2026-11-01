import type { Metadata } from "next";
import { SalesTrend } from "@/components/sales/sales-trend";
export const metadata: Metadata = { title: "Sales Trend" };
export default function Page() { return <SalesTrend />; }

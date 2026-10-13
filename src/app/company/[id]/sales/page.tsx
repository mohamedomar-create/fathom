import type { Metadata } from "next";
import { SalesOverview } from "@/components/sales/sales-overview";
export const metadata: Metadata = { title: "Sales Overview" };
export default function Page() { return <SalesOverview />; }

import type { Metadata } from "next";
import { SalesCustomers } from "@/components/sales/sales-customers";
export const metadata: Metadata = { title: "Customers" };
export default function Page() { return <SalesCustomers />; }

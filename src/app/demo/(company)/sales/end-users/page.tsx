import type { Metadata } from "next";
import { SalesEndUsers } from "@/components/sales/sales-end-users";
import { demoEndUsers } from "@/lib/company/demo-end-users";
export const metadata: Metadata = { title: "End users" };
export default function Page() { return <SalesEndUsers data={demoEndUsers()} />; }

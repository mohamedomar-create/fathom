import type { Metadata } from "next";
import { SalesEndUsers } from "@/components/sales/sales-end-users";
import { loadEndUsers } from "@/lib/company/end-users-load";
export const metadata: Metadata = { title: "End users" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SalesEndUsers data={await loadEndUsers(id)} />;
}

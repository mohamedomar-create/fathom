import type { Metadata } from "next";
import { EndUserChoices } from "@/components/data/end-user-choices";
import { loadEndUsers } from "@/lib/company/end-users-load";
export const metadata: Metadata = { title: "End users" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EndUserChoices data={await loadEndUsers(id)} />;
}

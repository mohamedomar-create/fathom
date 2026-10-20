import type { Metadata } from "next";
import { EndUserChoices } from "@/components/data/end-user-choices";
import { AgencyStatementUpload } from "@/components/data/agency-statement-upload";
import { loadEndUsers } from "@/lib/company/end-users-load";
import { booksStartOf } from "@/lib/company/time-zone";
import { getUser } from "@/lib/supabase/server";
export const metadata: Metadata = { title: "End users" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await getUser();
  const [data, { data: co }] = await Promise.all([loadEndUsers(id), supabase.from("companies").select("kpi_config").eq("id", id).maybeSingle()]);
  return (
    <div className="space-y-12">
      <AgencyStatementUpload data={data} booksStart={booksStartOf(co?.kpi_config)} />
      <EndUserChoices data={data} />
    </div>
  );
}

import { redirect } from "next/navigation";
import { SummaryPage } from "@/components/analysis/summary-page";
import { loadCompanyMeta } from "@/lib/company/meta";
import { modeOf } from "@/lib/company/mode";

/** The company's first page: Simple-mode companies land on their own Overview. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const meta = await loadCompanyMeta(id);
  if (modeOf(meta.kpiConfig) === "simple") redirect(`/company/${id}/simple`);
  return <SummaryPage />;
}

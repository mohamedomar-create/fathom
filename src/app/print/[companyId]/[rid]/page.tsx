import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReportDocument } from "@/components/report/report-document";
import { isUuid } from "@/lib/ids";
import { loadCompanyReportInput } from "@/lib/report/company-input";

export const metadata: Metadata = { title: "Report", robots: { index: false, follow: false } };

/** A saved report alone, drawn on the server from the company's figures for a signed-in member: what its PDF is printed from. */
export default async function PrintReport({ params }: { params: Promise<{ companyId: string; rid: string }> }) {
  const { companyId, rid } = await params;
  if (!isUuid(companyId) || !isUuid(rid)) notFound();
  const r = await loadCompanyReportInput(companyId, rid);
  if (!r) notFound();
  return <ReportDocument input={r.input} />;
}

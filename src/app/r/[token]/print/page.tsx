import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReportDocument } from "@/components/report/report-document";
import { loadPublicReportInput } from "@/lib/report/public-input";

export const metadata: Metadata = { title: "Report", robots: { index: false, follow: false } };

/** The report alone, drawn on the server from the link's (frozen) figures: what the PDF is printed from. */
export default async function PrintPublicReport({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const input = await loadPublicReportInput(token);
  if (!input) notFound();
  return <ReportDocument input={input} />;
}

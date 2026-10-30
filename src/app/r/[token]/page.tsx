import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPublicReportInput } from "@/lib/report/public-input";
import { PublicReport } from "./public-report";

export const metadata: Metadata = { title: "Report", robots: { index: false, follow: false } };

export default async function PublicReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const input = await loadPublicReportInput(token);
  if (!input) notFound();
  return <PublicReport token={token} input={input} />;
}

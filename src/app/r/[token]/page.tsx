import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPublicReportInput, ReportUnavailable } from "@/lib/report/public-input";
import { PublicReport } from "./public-report";
import { getDict } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Report", robots: { index: false, follow: false } };

export default async function PublicReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let input: Awaited<ReturnType<typeof loadPublicReportInput>>;
  try {
    input = await loadPublicReportInput(token);
  } catch (e) {
    if (!(e instanceof ReportUnavailable)) throw e;
    const t = (await getDict()).rep.pub;
    // The figures couldn't be read just now: never "not found" (the link works), and never a report of zeros.
    return (
      <div className="mx-auto max-w-xl py-24 text-center" role="alert" data-testid="report-unavailable">
        <h1 className="text-2xl font-light">{t.unavailable}</h1>
        <p className="mt-2 text-mute">{t.unavailableText}</p>
      </div>
    );
  }
  if (!input) notFound();
  return <PublicReport token={token} input={input} />;
}

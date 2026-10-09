import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildMonths, naturalAccounts } from "@/lib/company/build";
import { settingsFromRow } from "@/lib/company/load";
import { normaliseSections } from "@/lib/report/types";
import type { ClassKey, PeriodType } from "@/lib/engine";
import type { CompanyRow } from "@/lib/supabase/database.types";
import { PublicReport } from "./public-report";

export const metadata: Metadata = { title: "Report", robots: { index: false, follow: false } };

interface Payload {
  report: { title: string; period_type: string; period_end: string; sections: unknown };
  company: Pick<CompanyRow, "id" | "name" | "currency" | "fy_start_month" | "tax_rate" | "kpi_config" | "notes" | "source">;
  org: { name: string; logo_url: string | null; brand_colour: string | null; disclaimer: string; report_footer: string | null };
  accounts: { id: string; code: string; name: string; class: string; amounts: Record<string, number> }[];
  commentary: Record<string, string>;
  accepted?: { title: string; period?: string | null; reason: string }[] | null;
}

export default async function PublicReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_published_report", { p_token: token });
  if (!data) notFound();
  const p = data as unknown as Payload;
  const accounts = naturalAccounts(p.accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, cls: a.class as ClassKey, raw: Object.fromEntries(Object.entries(a.amounts).map(([k, v]) => [k, Number(v)])) })));
  const { settings, alerts } = settingsFromRow(p.company);
  return (
    <PublicReport token={token}
      input={{
        title: p.report.title, companyName: p.company.name, months: buildMonths(accounts), accounts, settings, alerts,
        sel: { type: p.report.period_type as PeriodType, end: p.report.period_end }, sections: normaliseSections(p.report.sections),
        commentary: p.commentary ?? {}, notes: (p.company.notes as string[]) ?? [],
        accepted: (p.accepted ?? []).map((a) => ({ title: a.title, period: a.period ?? undefined, reason: a.reason })),
        org: { name: p.org.name, logoUrl: p.org.logo_url, brandColour: p.org.brand_colour, disclaimer: p.org.disclaimer, footer: p.org.report_footer },
        preparedOn: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
      }} />
  );
}

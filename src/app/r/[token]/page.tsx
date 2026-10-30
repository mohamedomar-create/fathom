import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildMonths, naturalAccounts } from "@/lib/company/build";
import { withSubClasses } from "@/lib/ingest/subclass";
import { assumptionsFromRow, forecastFromRow, settingsFromRow } from "@/lib/company/load";
import { normaliseSections, reportMonths } from "@/lib/report/types";
import { parseSalesSummary } from "@/lib/company/sales-parse";
import { parseExpenseSummary } from "@/lib/company/expenses-parse";
import type { ClassKey, PeriodType } from "@/lib/engine";
import { currentAsOf } from "@/lib/engine";
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
  /** How far the books go (0041): a part month reads as one, as in the app. */
  as_of?: string | null;
  /** The company's sub-class choices (0042), so the link's cash flow reads as the app's. */
  sub_classes?: Record<string, string> | null;
  /** The company's VAT rate (0042), so debtor days read as in the app. */
  vat_rate?: number | null;
}

export default async function PublicReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const [{ data }, { data: salesRaw }, { data: expensesRaw }] = await Promise.all([
    supabase.rpc("get_published_report", { p_token: token }),
    supabase.rpc("get_published_sales", { p_token: token }),
    supabase.rpc("get_published_expenses", { p_token: token }),
  ]);
  if (!data) notFound();
  const p = data as unknown as Payload;
  const accounts = withSubClasses(naturalAccounts(p.accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, cls: a.class as ClassKey, raw: Object.fromEntries(Object.entries(a.amounts).map(([k, v]) => [k, Number(v)])) }))), p.sub_classes ?? {});
  const { settings: base, alerts } = settingsFromRow(p.company);
  const settings = typeof p.vat_rate === "number" && p.vat_rate >= 0 && p.vat_rate <= 0.5 ? { ...base, vatRate: p.vat_rate } : base;
  const all = buildMonths(accounts);
  return (
    <PublicReport token={token}
      input={{
        title: p.report.title, companyName: p.company.name, months: reportMonths(all, p.report.period_end), accounts, settings, alerts,
        sel: { type: p.report.period_type as PeriodType, end: p.report.period_end }, sections: normaliseSections(p.report.sections),
        assumptions: assumptionsFromRow(p.company), forecast: forecastFromRow(p.company), sales: parseSalesSummary(salesRaw), expenses: parseExpenseSummary(expensesRaw), commentary: p.commentary ?? {}, notes: (p.company.notes as string[]) ?? [],
        accepted: (p.accepted ?? []).map((a) => ({ title: a.title, period: a.period ?? undefined, reason: a.reason })),
        org: { name: p.org.name, logoUrl: p.org.logo_url, brandColour: p.org.brand_colour, disclaimer: p.org.disclaimer, footer: p.org.report_footer },
        preparedOn: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
        // As on the company's pages: the stop day counts only while it falls in the latest month the link carries.
        asOf: currentAsOf(p.as_of, all.map((m) => m.period)),
      }} />
  );
}

import "server-only";
import { createClient } from "@/lib/supabase/server";
import { buildMonths, naturalAccounts } from "@/lib/company/build";
import { withSubClasses } from "@/lib/ingest/subclass";
import { assumptionsFromRow, forecastFromRow, settingsFromRow } from "@/lib/company/load";
import { normaliseSections, reportMonths, type ReportInput } from "@/lib/report/types";
import { parseSalesSummary } from "@/lib/company/sales-parse";
import { parseExpenseSummary } from "@/lib/company/expenses-parse";
import type { ClassKey, PeriodType } from "@/lib/engine";
import { currentAsOf } from "@/lib/engine";
import type { CompanyRow } from "@/lib/supabase/database.types";

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
  /** When the figures were frozen at publishing (0043); absent for a link still read live. */
  frozen_at?: string | null;
}

const longDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

/** A published report's figures for its link (the frozen ones once published), or null when the link doesn't work. */
export async function loadPublicReportInput(token: string): Promise<ReportInput | null> {
  const supabase = await createClient();
  const [{ data }, { data: salesRaw }, { data: expensesRaw }] = await Promise.all([
    supabase.rpc("get_published_report", { p_token: token }),
    supabase.rpc("get_published_sales", { p_token: token }),
    supabase.rpc("get_published_expenses", { p_token: token }),
  ]);
  if (!data) return null;
  const p = data as unknown as Payload;
  const accounts = withSubClasses(naturalAccounts(p.accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, cls: a.class as ClassKey, raw: Object.fromEntries(Object.entries(a.amounts).map(([k, v]) => [k, Number(v)])) }))), p.sub_classes ?? {});
  const { settings: base, alerts } = settingsFromRow(p.company);
  const settings = typeof p.vat_rate === "number" && p.vat_rate >= 0 && p.vat_rate <= 0.5 ? { ...base, vatRate: p.vat_rate } : base;
  const all = buildMonths(accounts);
  return {
    title: p.report.title, companyName: p.company.name, months: reportMonths(all, p.report.period_end), accounts, settings, alerts,
    sel: { type: p.report.period_type as PeriodType, end: p.report.period_end }, sections: normaliseSections(p.report.sections),
    assumptions: assumptionsFromRow(p.company), forecast: forecastFromRow(p.company), sales: parseSalesSummary(salesRaw), expenses: parseExpenseSummary(expensesRaw), commentary: p.commentary ?? {}, notes: (p.company.notes as string[]) ?? [],
    accepted: (p.accepted ?? []).map((a) => ({ title: a.title, period: a.period ?? undefined, reason: a.reason })),
    org: { name: p.org.name, logoUrl: p.org.logo_url, brandColour: p.org.brand_colour, disclaimer: p.org.disclaimer, footer: p.org.report_footer },
    // A frozen report says the day its figures were published, not the day it is read.
    preparedOn: longDate(p.frozen_at ? new Date(p.frozen_at) : new Date()),
    // As on the company's pages: the stop day counts only while it falls in the latest month the link carries.
    asOf: currentAsOf(p.as_of, all.map((m) => m.period)),
  };
}

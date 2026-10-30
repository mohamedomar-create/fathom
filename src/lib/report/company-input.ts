import "server-only";
import { getUser } from "@/lib/supabase/server";
import { loadCompanyBundle } from "@/lib/company/load";
import { loadSales } from "@/lib/company/sales-load";
import { loadExpenses } from "@/lib/company/expenses-load";
import { selectableEnds, windowFor, type PeriodType } from "@/lib/engine";
import { normaliseSections, type ReportInput } from "@/lib/report/types";

/**
 * A saved report with the company's current figures, read on the server for the signed-in member (as the report editor
 * shows it once saved): what its PDF is printed from. Null when the report isn't this person's to read.
 */
export async function loadCompanyReportInput(companyId: string, reportId: string): Promise<{ input: ReportInput; footer: string } | null> {
  const { supabase, user } = await getUser();
  if (!user) return null;
  const { data: r } = await supabase.from("reports").select("*").eq("id", reportId).eq("company_id", companyId).maybeSingle();
  if (!r) return null;
  const c = await loadCompanyBundle(companyId);
  const { data: o } = await supabase.from("organizations").select("name, logo_url, brand_colour, disclaimer, report_footer").eq("id", c.orgId).maybeSingle();
  if (!o) return null;
  const [sales, expenses] = await Promise.all([loadSales(companyId), loadExpenses(companyId)]);
  const type = r.period_type as PeriodType;
  const ends = selectableEnds(c.months, type, c.settings.fyStartMonth);
  const end = ends.some((e) => e.end === r.period_end) ? r.period_end : ends[ends.length - 1]?.end ?? r.period_end;
  // The commentary saved for this report's period, as the editor shows it.
  const key = `${type}:${end}`;
  const commentary: Record<string, string> = {};
  for (const [k, v] of Object.entries(c.commentary)) { const [pk, s] = k.split("|"); if (pk === key && s) commentary[s] = v; else if (!s) commentary[k] = v; }
  const org = { name: o.name, logoUrl: o.logo_url, brandColour: o.brand_colour, disclaimer: o.disclaimer, footer: o.report_footer };
  return {
    input: {
      title: r.title, companyName: c.name, months: c.months, accounts: c.accounts, settings: c.settings, alerts: c.alerts,
      sel: { type, end }, sections: normaliseSections(r.sections), commentary, org, notes: c.notes ?? [], accepted: c.accepted ?? [], assumptions: c.assumptions ?? {}, forecast: c.forecast ?? {},
      sales: sales.data, expenses: expenses.data, asOf: c.asOf ?? null,
      preparedOn: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    },
    footer: o.report_footer || `${c.name} (${windowFor({ type, end }, c.settings.fyStartMonth).label}) - Prepared by ${o.name}`,
  };
}

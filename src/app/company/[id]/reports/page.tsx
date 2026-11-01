import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { getUser } from "@/lib/supabase/server";
import { windowFor, type PeriodType } from "@/lib/engine";
import { loadCompanyBundle } from "@/lib/company/load";
import { createReport } from "./actions";
import { isRefusal, REPORT_REFUSAL } from "@/lib/report/create-guard";
import { SubmitOnce } from "@/components/ui/submit-once";
import { getLang } from "@/lib/i18n/server";
import { dict, monthLabel, periodLabel } from "@/lib/i18n";

export default async function ReportsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const { error: refusal } = await searchParams;
  const { supabase } = await getUser();
  const lang = await getLang();
  const t = dict(lang).rep.list;
  // The same figures the other pages show (the company bundle, loaded once per request), so "Create report" is open
  // exactly when the pages have financial months. It used to read the balances table separately and treat a failed or
  // slow read as "no data".
  const [c, { data: reports, error: listError }] = await Promise.all([
    loadCompanyBundle(id),
    supabase.from("reports").select("id, title, period_type, period_end, status, updated_at").eq("company_id", id).order("updated_at", { ascending: false }),
  ]);
  const last = c.months.length ? c.months[c.months.length - 1].period : null;
  const canEdit = !c.readOnly;
  // Why the button is not offered or not usable, in one sentence.
  const blocked = !canEdit ? t.refusal["view-only"] ?? REPORT_REFUSAL["view-only"]
    : !last ? t.noFigures(c.dataVersion)
    : null;
  const create = createReport.bind(null, id, last ?? new Date().toISOString().slice(0, 7));
  return (
    <div className="mx-auto max-w-5xl py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div><div className="label">{t.label}</div><h1 className="text-3xl font-light">{t.title}</h1>
          <p className="text-mute">{t.sub}</p></div>
        {canEdit && <form action={create}><SubmitOnce disabled={!last} aria-describedby={blocked ? "report-blocked" : undefined} className="flex items-center gap-1.5 rounded bg-brand-d px-4 py-2 font-medium text-white disabled:opacity-50" data-testid="create-report"><Plus className="h-4 w-4" />{t.create}</SubmitOnce></form>}
      </div>
      {isRefusal(refusal) && <p role="alert" className="mb-4 rounded bg-red-bg px-3 py-2 text-sm text-red" data-testid="report-refused">{t.refusal[refusal] ?? REPORT_REFUSAL[refusal]}</p>}
      {blocked && (
        <p id="report-blocked" className="mb-4 rounded bg-amber/15 px-3 py-2 text-sm" data-testid="report-blocked">
          {blocked}{canEdit && !last && <> <Link href={`/company/${id}/data`} className="underline">{t.openSteps}</Link></>}
        </p>
      )}
      {listError ? (
        <p role="alert" className="rounded border border-amber/60 bg-amber/10 px-3 py-2 text-sm" data-testid="reports-list-failed">{t.listFailed}</p>
      ) : (
      <table className="tbl text-sm">
        <thead><tr><th>{t.name}</th><th>{t.period}</th><th>{t.status}</th><th>{t.edited}</th></tr></thead>
        <tbody>
          {(reports ?? []).map((r) => (
            <tr key={r.id} className="row">
              <td><Link href={`/company/${id}/reports/${r.id}`} className="flex items-center gap-2 font-medium hover:underline"><FileText className="h-4 w-4 text-brand-d" />{r.title === "Monthly Performance Report" ? dict(lang).rep.defaultTitle : r.title}</Link></td>
              <td>{periodLabel(windowFor({ type: r.period_type as PeriodType, end: r.period_end }, c.settings.fyStartMonth).label, lang)}</td>
              <td><span className={r.status === "published" ? "rounded bg-green-bg px-2 py-0.5 text-xs text-green-d" : "rounded bg-band px-2 py-0.5 text-xs text-mute"}>{r.status === "published" ? t.published : t.draft}</span></td>
              <td className="text-mute">{lang === "ar" ? `${new Date(r.updated_at).getUTCDate()} ${monthLabel(r.updated_at.slice(0, 7), "ar")}` : new Date(r.updated_at).toLocaleDateString("en-GB", { dateStyle: "medium" })}</td>
            </tr>
          ))}
          {!reports?.length && <tr><td colSpan={4} className="py-10 text-center text-mute">{t.none}</td></tr>}
        </tbody>
      </table>
      )}
    </div>
  );
}

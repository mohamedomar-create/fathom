import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { getUser } from "@/lib/supabase/server";
import { windowFor, type PeriodType } from "@/lib/engine";
import { loadCompanyBundle } from "@/lib/company/load";
import { createReport } from "./actions";

export default async function ReportsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await getUser();
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
  const blocked = !canEdit ? "View-only access: an editor or admin of this company creates reports."
    : !last ? `No financial figures are loaded for the current version (version ${c.dataVersion}). Upload the General Ledger on Data ▸ Steps first.`
    : null;
  const create = createReport.bind(null, id, last ?? new Date().toISOString().slice(0, 7));
  return (
    <div className="mx-auto max-w-5xl py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div><div className="label">Reports</div><h1 className="text-3xl font-light">Management reports</h1>
          <p className="text-mute">Branded A4 reports with commentary — download as PDF or share a link.</p></div>
        {canEdit && <form action={create}><button disabled={!last} aria-describedby={blocked ? "report-blocked" : undefined} className="flex items-center gap-1.5 rounded bg-brand-d px-4 py-2 font-medium text-white disabled:opacity-50" data-testid="create-report"><Plus className="h-4 w-4" />Create report</button></form>}
      </div>
      {blocked && (
        <p id="report-blocked" className="mb-4 rounded bg-amber/15 px-3 py-2 text-sm" data-testid="report-blocked">
          {blocked}{canEdit && !last && <> <Link href={`/company/${id}/data`} className="underline">Open Data ▸ Steps</Link></>}
        </p>
      )}
      {listError ? (
        <p role="alert" className="rounded border border-amber/60 bg-amber/10 px-3 py-2 text-sm" data-testid="reports-list-failed">The list of reports couldn&apos;t be loaded just now. Reload the page to try again.</p>
      ) : (
      <table className="tbl text-sm">
        <thead><tr><th>Name</th><th>Period</th><th>Status</th><th>Last edited</th></tr></thead>
        <tbody>
          {(reports ?? []).map((r) => (
            <tr key={r.id} className="row">
              <td><Link href={`/company/${id}/reports/${r.id}`} className="flex items-center gap-2 font-medium hover:underline"><FileText className="h-4 w-4 text-brand-d" />{r.title}</Link></td>
              <td>{windowFor({ type: r.period_type as PeriodType, end: r.period_end }, c.settings.fyStartMonth).label}</td>
              <td><span className={r.status === "published" ? "rounded bg-green-bg px-2 py-0.5 text-xs text-green-d" : "rounded bg-band px-2 py-0.5 text-xs text-mute"}>{r.status === "published" ? "Published" : "Draft"}</span></td>
              <td className="text-mute">{new Date(r.updated_at).toLocaleDateString("en-GB", { dateStyle: "medium" })}</td>
            </tr>
          ))}
          {!reports?.length && <tr><td colSpan={4} className="py-10 text-center text-mute">No reports yet. Create one from the Monthly Performance Report template.</td></tr>}
        </tbody>
      </table>
      )}
    </div>
  );
}

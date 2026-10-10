import Link from "next/link";
import { FileText, Plus } from "lucide-react";
import { getUser } from "@/lib/supabase/server";
import { windowFor, type PeriodType } from "@/lib/engine";
import { createReport } from "./actions";

export default async function ReportsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  const [{ data: reports }, { data: c }] = await Promise.all([
    supabase.from("reports").select("id, title, period_type, period_end, status, updated_at").eq("company_id", id).order("updated_at", { ascending: false }),
    supabase.from("companies").select("fy_start_month, data_version, org_id").eq("id", id).single(),
  ]);
  const [{ data: last }, { data: mem }] = await Promise.all([
    supabase.from("account_balances").select("period, source_accounts!inner(version)").eq("company_id", id).eq("source_accounts.version", c?.data_version ?? 0)
      .order("period", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("memberships").select("role").eq("org_id", c?.org_id ?? "").eq("user_id", user?.id ?? "").maybeSingle(),
  ]);
  const canEdit = mem?.role === "admin" || mem?.role === "editor";
  const create = createReport.bind(null, id, last?.period ?? new Date().toISOString().slice(0, 7));
  return (
    <div className="mx-auto max-w-5xl py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div><div className="label">Reports</div><h1 className="text-3xl font-light">Management reports</h1>
          <p className="text-mute">Branded A4 reports with commentary — download as PDF or share a link.</p></div>
        {canEdit && <form action={create}><button disabled={!last} className="flex items-center gap-1.5 rounded bg-brand-d px-4 py-2 font-medium text-white disabled:opacity-50" data-testid="create-report"><Plus className="h-4 w-4" />Create report</button></form>}
      </div>
      {!last && <p className="mb-4 rounded bg-amber/15 px-3 py-2 text-sm">Add financial data first (Settings → Source Data).</p>}
      <table className="tbl text-sm">
        <thead><tr><th>Name</th><th>Period</th><th>Status</th><th>Last edited</th></tr></thead>
        <tbody>
          {(reports ?? []).map((r) => (
            <tr key={r.id} className="row">
              <td><Link href={`/company/${id}/reports/${r.id}`} className="flex items-center gap-2 font-medium hover:underline"><FileText className="h-4 w-4 text-brand-d" />{r.title}</Link></td>
              <td>{windowFor({ type: r.period_type as PeriodType, end: r.period_end }, c?.fy_start_month ?? 1).label}</td>
              <td><span className={r.status === "published" ? "rounded bg-green-bg px-2 py-0.5 text-xs text-green-d" : "rounded bg-band px-2 py-0.5 text-xs text-mute"}>{r.status === "published" ? "Published" : "Draft"}</span></td>
              <td className="text-mute">{new Date(r.updated_at).toLocaleDateString("en-GB", { dateStyle: "medium" })}</td>
            </tr>
          ))}
          {!reports?.length && <tr><td colSpan={4} className="py-10 text-center text-mute">No reports yet. Create one from the Monthly Performance Report template.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { UploadWizard } from "@/components/settings/upload-wizard";
import { OdooPanel } from "@/components/settings/odoo-panel";
import { cn } from "@/lib/cn";

export default async function SourceDataPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab = "upload" } = await searchParams;
  const { supabase } = await getUser();
  const [{ data: c }, { data: imports }, { data: odoo }] = await Promise.all([
    supabase.from("companies").select("currency, fy_start_month, data_version, last_synced_at, source").eq("id", id).single(),
    supabase.from("imports").select("id, kind, filename, created_at, report").eq("company_id", id).order("created_at", { ascending: false }).limit(12),
    supabase.from("odoo_connections").select("url, db, login, odoo_company_id, odoo_company_name, include_branches, months_history, version, status, last_error, last_sync_at").eq("company_id", id).maybeSingle(),
  ]);
  const lastUpload = imports?.find((i) => i.kind === "upload");
  const savedMapping = ((lastUpload?.report as { mapping?: Record<string, string> } | null)?.mapping) ?? {};
  const tabs = [{ k: "upload", l: "Upload Odoo export" }, { k: "odoo", l: "Connect Odoo (live)" }, { k: "history", l: `Import history (${imports?.length ?? 0})` }];
  return (
    <div>
      <div className="label">1 · Source Data</div>
      <h1 className="mb-1 text-3xl font-light">Financials</h1>
      <p className="mb-5 text-mute">Bring in monthly P&amp;L and balance sheet data from Odoo. Each import replaces the previous data for this company.</p>
      <div className="mb-6 flex gap-1 border-b border-line">
        {tabs.map((t) => (
          <Link key={t.k} href={`?tab=${t.k}`} scroll={false} className={cn("-mb-px border-b-2 px-4 py-2 text-sm", tab === t.k ? "border-green-d font-semibold" : "border-transparent text-mute hover:text-ink")}>{t.l}</Link>
        ))}
      </div>
      {tab === "upload" && c && <UploadWizard companyId={id} currency={c.currency} fyStart={c.fy_start_month} savedMapping={savedMapping} hasData={c.data_version > 0} />}
      {tab === "odoo" && c && <OdooPanel companyId={id} connection={odoo} hasData={c.data_version > 0} />}
      {tab === "history" && (
        <table className="tbl text-sm">
          <thead><tr><th>Imported</th><th>Source</th><th>File</th><th>Months</th><th>Notes</th></tr></thead>
          <tbody>
            {(imports ?? []).map((i) => {
              const r = (i.report ?? {}) as { periods?: string[]; warnings?: string[]; notes?: string[] };
              return (
                <tr key={i.id} className="row">
                  <td>{new Date(i.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</td>
                  <td className="capitalize">{i.kind}</td>
                  <td className="max-w-56 truncate">{i.filename ?? "–"}</td>
                  <td>{r.periods?.length ?? "–"}</td>
                  <td className="max-w-80 whitespace-normal text-left text-xs text-mute">{[...(r.warnings ?? []), ...(r.notes ?? [])].slice(0, 3).join(" · ") || "–"}</td>
                </tr>
              );
            })}
            {!imports?.length && <tr><td colSpan={5} className="py-8 text-center text-mute">No imports yet.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

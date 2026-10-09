export const maxDuration = 60;

import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { UploadWizard } from "@/components/settings/upload-wizard";
import { OdooPanel, type OdooConn } from "@/components/settings/odoo-panel";
import { cn } from "@/lib/cn";

export default async function SourceDataPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab = "upload" } = await searchParams;
  const { supabase } = await getUser();
  const [{ data: c }, { data: imports }, { data: odoo }] = await Promise.all([
    supabase.from("companies").select("currency, fy_start_month, data_version, last_synced_at, source").eq("id", id).single(),
    supabase.from("imports").select("id, kind, report").eq("company_id", id).eq("kind", "upload").eq("action", "import").order("created_at", { ascending: false }).limit(1),
    supabase.from("odoo_connections").select("url, db, login, odoo_company_id, odoo_company_name, include_branches, months_history, version, status, last_error, last_sync_at").eq("company_id", id).maybeSingle(),
  ]);
  const lastUpload = imports?.find((i) => i.kind === "upload");
  const savedMapping = ((lastUpload?.report as { mapping?: Record<string, string> } | null)?.mapping) ?? {};
  const tabs = [{ k: "upload", l: "Upload Odoo export" }, { k: "odoo", l: "Connect Odoo (live)" }];
  return (
    <div>
      <div className="label">1 · Source Data</div>
      <h1 className="mb-1 text-3xl font-light">Financials</h1>
      <p className="mb-5 text-mute">Bring in monthly P&amp;L and balance sheet data from Odoo. Uploads can add or replace single months; the P&amp;L and balance sheet can come from separate files. See <Link href={`/company/${id}/settings/data-health`} className="text-green-d underline">Data health</Link> for loaded months, checks and undo.</p>
      <div className="mb-6 flex gap-1 border-b border-line">
        {tabs.map((t) => (
          <Link key={t.k} href={`?tab=${t.k}`} scroll={false} className={cn("-mb-px border-b-2 px-4 py-2 text-sm", tab === t.k ? "border-green-d font-semibold" : "border-transparent text-mute hover:text-ink")}>{t.l}</Link>
        ))}
      </div>
      {tab === "upload" && c && <UploadWizard companyId={id} currency={c.currency} fyStart={c.fy_start_month} savedMapping={savedMapping} hasData={c.data_version > 0} />}
      {tab === "odoo" && c && <OdooPanel companyId={id} connection={odoo as OdooConn | null} hasData={c.data_version > 0} />}
    </div>
  );
}

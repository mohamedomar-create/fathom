export const maxDuration = 60;

import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { booksStartOf } from "@/lib/company/time-zone";
import { loadCompanyBundle } from "@/lib/company/load";
import { UploadWizard } from "@/components/settings/upload-wizard";
import { OdooPanel, type OdooConn } from "@/components/settings/odoo-panel";
import { cn } from "@/lib/cn";
import { loadAccountMap } from "@/lib/company/account-map";

export default async function SourceDataPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; step?: string }> }) {
  const { id } = await params;
  const { tab = "upload", step } = await searchParams;
  const { supabase } = await getUser();
  const { role } = await loadCompanyBundle(id);
  const [{ data: c }, { data: imports }, { data: odoo, error: odooErr }, { data: batches }, { data: expBatches }, { data: audit }] = await Promise.all([
    supabase.from("companies").select("currency, fy_start_month, data_version, last_synced_at, source, kpi_config").eq("id", id).single(),
    supabase.from("imports").select("id, kind, report").eq("company_id", id).eq("kind", "upload").eq("action", "import").order("created_at", { ascending: false }).limit(1),
    supabase.from("odoo_connections").select("url, db, login, odoo_company_id, odoo_company_name, include_branches, months_history, version, status, last_error, last_sync_at, has_key, key_expires_on").eq("company_id", id).maybeSingle(),
    supabase.from("sales_batches").select("periods").eq("company_id", id).eq("source", "file"),
    supabase.from("expense_batches").select("periods").eq("company_id", id).eq("source", "file"),
    supabase.from("odoo_audit").select("id, user_id, action, ok, detail, rows_read, at").eq("company_id", id).order("at", { ascending: false }).limit(20),
  ]);
  // Who did each logged Odoo action (members of the same organisation can see each other's profiles).
  const who = [...new Set((audit ?? []).map((a) => a.user_id).filter((u): u is string => Boolean(u)))];
  const { data: people } = who.length ? await supabase.from("profiles").select("id, email, full_name").in("id", who) : { data: [] };
  const name = new Map((people ?? []).map((p) => [p.id, p.full_name || p.email]));
  const odooLog = (audit ?? []).map((a) => ({ ...a, who: a.user_id ? name.get(a.user_id) ?? "a former member" : "—" }));
  // Other companies this person can see, to start this one from what they have learned (classes, books start).
  const [{ data: others }, { count: mapCount }] = await Promise.all([
    supabase.from("companies").select("id, name").neq("id", id).order("name"),
    supabase.from("account_map").select("key", { count: "exact", head: true }).eq("company_id", id),
  ]);
  // The Odoo security update (migration 0025) adds the columns read above; until it runs, the connection stays closed.
  const odooReady = !odooErr || odooErr.code !== "42703";
  // Months that already have sales from a file: a new sales file asks before replacing them.
  const salesLoaded = [...new Set((batches ?? []).flatMap((b) => (b.periods as string[] | null) ?? []))].sort();
  const expensesLoaded = [...new Set((expBatches ?? []).flatMap((b) => (b.periods as string[] | null) ?? []))].sort();
  const lastUpload = imports?.find((i) => i.kind === "upload");
  // The company's account map (every class a person has chosen); before it existed, the last upload's mapping.
  const [accountMap, { data: profiles }] = await Promise.all([loadAccountMap(supabase, id), supabase.from("input_profiles").select("kind, headings").eq("company_id", id)]);
  // The company's remembered export layouts (none before the database has them).
  const savedLayouts = Object.fromEntries((profiles ?? []).map((p) => [p.kind, p.headings]));
  const savedMapping = Object.keys(accountMap).length ? accountMap : ((lastUpload?.report as { mapping?: Record<string, string> } | null)?.mapping) ?? {};
  const tabs = [{ k: "upload", l: "Upload a file" }, { k: "odoo", l: "Connect Odoo (live)" }];
  return (
    <div>
      <div className="label">2 · Source Data</div>
      <h1 className="mb-1 text-3xl font-light">Add your data</h1>
      <p className="mb-5 text-mute">Step by step. Nothing is saved until you press Save. <Link href={`/company/${id}/settings/data-health`} className="text-brand-d underline">Undo an upload</Link></p>
      <div className="mb-6 flex gap-1 border-b border-line">
        {tabs.map((t) => (
          <Link key={t.k} href={`?tab=${t.k}`} scroll={false} className={cn("-mb-px border-b-2 px-4 py-2 text-sm", tab === t.k ? "border-brand-d font-semibold" : "border-transparent text-mute hover:text-ink")}>{t.l}</Link>
        ))}
      </div>
      {role === "viewer" ? (
        <p className="rounded bg-band px-4 py-3 text-sm" data-testid="view-only">You have view-only access to this company, so you cannot import data or change the Odoo connection. Ask an admin of the organisation for editor access.</p>
      ) : <>
      {tab === "upload" && c && <UploadWizard companyId={id} currency={c.currency} fyStart={c.fy_start_month} savedMapping={savedMapping} savedLayouts={savedLayouts} hasData={c.data_version > 0} setupStep={step === "opening" || step === "sales" || step === "financials" || step === "expenses" || step === "inventory" ? step : undefined} salesLoaded={salesLoaded} expensesLoaded={expensesLoaded} booksStart={booksStartOf(c.kpi_config)} />}
      {tab === "odoo" && c && <OdooPanel companyId={id} connection={odoo as OdooConn | null} hasData={c.data_version > 0} booksStart={booksStartOf(c.kpi_config)} role={role === "admin" ? "admin" : "editor"} log={odooLog} ready={odooReady} others={others ?? []} mapCount={mapCount ?? 0} />}
      </>}
    </div>
  );
}

export const maxDuration = 60;

import { getUser } from "@/lib/supabase/server";
import { booksStartOf } from "@/lib/company/time-zone";
import { loadCompanyBundle } from "@/lib/company/load";
import { OdooPanel, type OdooConn } from "@/components/settings/odoo-panel";

export default async function DataOdooPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await getUser();
  const { role } = await loadCompanyBundle(id);
  const [{ data: c }, { data: odoo, error: odooErr }, { data: audit }] = await Promise.all([
    supabase.from("companies").select("currency, fy_start_month, data_version, last_synced_at, source, kpi_config").eq("id", id).single(),
    supabase.from("odoo_connections").select("url, db, login, odoo_company_id, odoo_company_name, include_branches, months_history, version, status, last_error, last_sync_at, has_key, key_expires_on").eq("company_id", id).maybeSingle(),
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
  return (
    <div>
      {role === "viewer" ? (
        <p className="rounded bg-band px-4 py-3 text-sm" data-testid="view-only">You have view-only access to this company, so you cannot change the Odoo connection. Ask an admin of the organisation for editor access.</p>
      ) : c && <OdooPanel companyId={id} connection={odoo as OdooConn | null} hasData={c.data_version > 0} booksStart={booksStartOf(c.kpi_config)} role={role === "admin" ? "admin" : "editor"} log={odooLog} ready={odooReady} others={others ?? []} mapCount={mapCount ?? 0} />}
    </div>
  );
}

import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { accessFrom, AccessError } from "./access";

export interface CompanyMeta { id: string; orgId: string; role: "admin" | "editor" | "viewer"; dataVersion: number; source: string; kpiConfig: unknown }

/**
 * What most Data pages need to know about the company: that the person is a member, their role, and which version of
 * the figures is current. Two small reads, once per request (the full company with every balance is loaded only where
 * the page shows figures).
 */
export const loadCompanyMeta = cache(async (id: string): Promise<CompanyMeta> => {
  const { supabase, user } = await getUser();
  if (!user) notFound();
  // A read that failed is an error (the error screen with a retry), not "not found"; no membership is not found.
  const { data: c, error: cErr } = await supabase.from("companies").select("id, org_id, data_version, source, kpi_config").eq("id", id).maybeSingle();
  if (cErr) throw new AccessError(cErr.code);
  if (!c) notFound();
  const { data: m, error: mErr } = await supabase.from("memberships").select("role").eq("org_id", c.org_id).eq("user_id", user.id).maybeSingle();
  const access = accessFrom(m, mErr);
  if (access === "none") notFound();
  return { id: c.id, orgId: c.org_id, role: access.role, dataVersion: c.data_version, source: c.source, kpiConfig: c.kpi_config };
});

const list = (rows: { id: string; created_at: string }[] | null) => (rows ?? []).map((r) => `${r.id}@${r.created_at}`).join(",");

/**
 * What the slow summaries are built from, in one round of small reads: every sales, expense and payments upload and
 * ageing report (each new or removed one changes it), the account classes (a changed class restamps expense lines)
 * and the current version of the figures. Checked once per request.
 */
export const summaryStamps = cache(async (id: string): Promise<{ sales: string; expenses: string; payments: string }> => {
  const meta = await loadCompanyMeta(id);
  const { supabase } = await getUser();
  const rows = "id, created_at";
  const [s, e, p, a, map] = await Promise.all([
    supabase.from("sales_batches").select(rows).eq("company_id", id).order("created_at"),
    supabase.from("expense_batches").select(rows).eq("company_id", id).order("created_at"),
    supabase.from("payment_batches").select(rows).eq("company_id", id).order("created_at"),
    supabase.from("aged_reports").select(rows).eq("company_id", id).order("created_at"),
    supabase.from("account_map").select("updated_at").eq("company_id", id).order("updated_at", { ascending: false }).limit(1),
  ]);
  const v = `v${meta.dataVersion}`;
  return {
    sales: `${v}|${list(s.data)}`,
    expenses: `${v}|${list(e.data)}|${map.data?.[0]?.updated_at ?? ""}|${(map.data ?? []).length}`,
    payments: `${v}|${list(p.data)}|${list(a.data)}`,
  };
});

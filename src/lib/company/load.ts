import "server-only";
import { notFound } from "next/navigation";
import type { ClassKey, CompanySettings, Importance } from "@/lib/engine";
import { getUser } from "@/lib/supabase/server";
import type { CompanyRow } from "@/lib/supabase/database.types";
import { buildMonths, naturalAccounts, type StoredAccount } from "./build";
import type { AlertSetting, CompanyBundle } from "./types";

export interface KpiConfigEntry { active?: boolean; importance?: Importance; target?: number | null; alert_active?: boolean; alert_threshold?: number | null }
export type KpiConfig = Record<string, KpiConfigEntry>;

export function settingsFromRow(c: Pick<CompanyRow, "currency" | "fy_start_month" | "tax_rate" | "kpi_config">): { settings: CompanySettings; alerts: Record<string, AlertSetting> } {
  const cfg = (c.kpi_config ?? {}) as KpiConfig;
  const targets: Record<string, number | null> = {};
  const importance: Record<string, Importance> = {};
  const alerts: Record<string, AlertSetting> = {};
  const active: string[] = [];
  let anyActive = false;
  for (const [k, v] of Object.entries(cfg)) {
    if (v.target !== undefined) targets[k] = v.target;
    if (v.importance) importance[k] = v.importance;
    if (v.alert_active !== undefined) alerts[k] = { active: !!v.alert_active, threshold: v.alert_threshold ?? null };
    if (v.active !== undefined) anyActive = true;
  }
  if (anyActive) {
    // Only explicit entries are stored; defaults apply to the rest.
    for (const [k, v] of Object.entries(cfg)) if (v.active) active.push(k);
  }
  return {
    settings: { currency: c.currency, fyStartMonth: c.fy_start_month, taxRate: Number(c.tax_rate), targets, importance, activeKpis: anyActive ? withDefaults(active, cfg) : undefined },
    alerts,
  };
}

import { KPI_DEFS } from "@/lib/engine";
function withDefaults(active: string[], cfg: KpiConfig) {
  const set = new Set(active);
  for (const d of KPI_DEFS) if (cfg[d.key]?.active === undefined && d.defaultActive) set.add(d.key);
  return [...set];
}

export async function loadAccounts(supabase: Awaited<ReturnType<typeof getUser>>["supabase"], companyId: string, version: number): Promise<StoredAccount[]> {
  const { data: accts, error } = await supabase.from("source_accounts").select("id, code, name, class, sort_order").eq("company_id", companyId).eq("version", version).order("sort_order");
  if (error) throw error;
  const raw = new Map<string, Record<string, number>>((accts ?? []).map((a) => [a.id, {}]));
  // Page through balances (PostgREST caps responses at 1000 rows by default).
  for (let from = 0; ; from += 1000) {
    const { data: bal, error: e2 } = await supabase.from("account_balances").select("account_id, period, amount").eq("company_id", companyId).range(from, from + 999);
    if (e2) throw e2;
    for (const b of bal ?? []) {
      const r = raw.get(b.account_id);
      if (r) r[b.period] = Number(b.amount);
    }
    if (!bal || bal.length < 1000) break;
  }
  return (accts ?? []).map((a) => ({ id: a.id, code: a.code, name: a.name, cls: a.class as ClassKey, raw: raw.get(a.id) ?? {} }));
}

export async function loadCompanyBundle(id: string): Promise<CompanyBundle & { role: string; orgId: string; dataVersion: number }> {
  const { supabase, user } = await getUser();
  if (!user) notFound();
  const { data: c } = await supabase.from("companies").select("*").eq("id", id).maybeSingle();
  if (!c) notFound();
  const [{ data: mem }, { data: org }, { data: list }, { data: comm }] = await Promise.all([
    supabase.from("memberships").select("role").eq("org_id", c.org_id).eq("user_id", user.id).maybeSingle(),
    supabase.from("organizations").select("name").eq("id", c.org_id).maybeSingle(),
    supabase.from("companies").select("id, name").eq("org_id", c.org_id).order("name"),
    supabase.from("commentary").select("period_key, section, body").eq("company_id", id),
  ]);
  const stored = await loadAccounts(supabase, id, c.data_version);
  const accounts = naturalAccounts(stored);
  const { settings, alerts } = settingsFromRow(c);
  const commentary: Record<string, string> = {};
  for (const r of comm ?? []) commentary[`${r.period_key}|${r.section}`] = r.body;
  return {
    id: c.id, name: c.name, basePath: `/company/${c.id}`, source: c.source as CompanyBundle["source"],
    months: buildMonths(accounts), settings, alerts, accounts, commentary, readOnly: mem?.role === "viewer",
    lastUpdated: c.last_synced_at, orgName: org?.name, notes: (c.notes as string[]) ?? [],
    companies: list ?? [], aiEnabled: Boolean(process.env.ANTHROPIC_API_KEY),
    role: mem?.role ?? "viewer", orgId: c.org_id, dataVersion: c.data_version,
  };
}

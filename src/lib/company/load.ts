import { cache } from "react";
import "server-only";
import { notFound } from "next/navigation";
import type { Assumptions, ClassKey, CompanySettings, Importance } from "@/lib/engine";
import { getUser } from "@/lib/supabase/server";
import type { CompanyRow } from "@/lib/supabase/database.types";
import { buildMonths, naturalAccounts, type StoredAccount } from "./build";
import type { AlertSetting, CompanyBundle } from "./types";

export interface KpiConfigEntry { active?: boolean; importance?: Importance; target?: number | null; alert_active?: boolean; alert_threshold?: number | null }
export type KpiConfig = Record<string, KpiConfigEntry>;
/** kpi_config also holds the economic assumptions under this key (not a KPI). */
export const ECONOMY_KEY = "economy";

export function assumptionsFromRow(c: Pick<CompanyRow, "kpi_config">): Assumptions {
  const e = ((c.kpi_config ?? {}) as Record<string, unknown>)[ECONOMY_KEY];
  return e && typeof e === "object" ? (e as Assumptions) : {};
}

export function settingsFromRow(c: Pick<CompanyRow, "currency" | "fy_start_month" | "tax_rate" | "kpi_config">): { settings: CompanySettings; alerts: Record<string, AlertSetting> } {
  const cfg = (c.kpi_config ?? {}) as KpiConfig;
  const targets: Record<string, number | null> = {};
  const importance: Record<string, Importance> = {};
  const alerts: Record<string, AlertSetting> = {};
  const active: string[] = [];
  let anyActive = false;
  for (const [k, v] of Object.entries(cfg)) {
    if (k === ECONOMY_KEY) continue;
    if (v.target !== undefined) targets[k] = v.target;
    if (v.importance) importance[k] = v.importance;
    if (v.alert_active !== undefined) alerts[k] = { active: !!v.alert_active, threshold: v.alert_threshold ?? null };
    if (v.active !== undefined) anyActive = true;
  }
  if (anyActive) {
    // Only explicit entries are stored; defaults apply to the rest.
    for (const [k, v] of Object.entries(cfg)) if (k !== ECONOMY_KEY && v.active) active.push(k);
  }
  return {
    settings: { currency: c.currency, fyStartMonth: c.fy_start_month, taxRate: Number(c.tax_rate), targets, importance, activeKpis: anyActive ? withDefaults(active, cfg) : undefined },
    alerts,
  };
}

import { KPI_DEFS } from "@/lib/engine";
import { checkKey, runChecks } from "./checks";
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
    const { data: bal, error: e2 } = await supabase.from("account_balances")
      .select("account_id, period, amount, source_accounts!inner(version)")
      .eq("company_id", companyId).eq("source_accounts.version", version)
      .order("account_id").order("period").range(from, from + 999);
    if (e2) throw e2;
    for (const b of bal ?? []) {
      const r = raw.get(b.account_id);
      if (r) r[b.period] = Number(b.amount);
    }
    if (!bal || bal.length < 1000) break;
  }
  return (accts ?? []).map((a) => ({ id: a.id, code: a.code, name: a.name, cls: a.class as ClassKey, raw: raw.get(a.id) ?? {} }));
}

export const loadCompanyBundle = cache(async (id: string): Promise<CompanyBundle & { role: string; orgId: string; dataVersion: number }> => {
  const { supabase, user } = await getUser();
  if (!user) notFound();
  const { data: c } = await supabase.from("companies").select("*").eq("id", id).maybeSingle();
  if (!c) notFound();
  const [{ data: mem }, { data: org }, { data: list }, { data: comm }, { data: imp }] = await Promise.all([
    supabase.from("memberships").select("role").eq("org_id", c.org_id).eq("user_id", user.id).maybeSingle(),
    supabase.from("organizations").select("name").eq("id", c.org_id).maybeSingle(),
    supabase.from("companies").select("id, name").eq("org_id", c.org_id).order("name"),
    supabase.from("commentary").select("period_key, section, body").eq("company_id", id),
    supabase.from("imports").select("report").eq("company_id", id).eq("data_version", c.data_version).eq("action", "import").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const stored = await loadAccounts(supabase, id, c.data_version);
  const accounts = naturalAccounts(stored);
  const { settings, alerts } = settingsFromRow(c);
  const months = buildMonths(accounts);
  const report = (imp?.report ?? {}) as { accepted?: { key: string; title: string; period?: string; reason: string }[]; asOf?: string };
  const accepted = report.accepted ?? [];
  // Only the latest month can be a part month: an older import's stop day no longer applies once later months exist.
  const asOf = report.asOf && months.length && report.asOf.startsWith(months[months.length - 1].period) ? report.asOf : undefined;
  const ok = new Set(accepted.map((a) => a.key));
  const failing = runChecks({ accounts, months }).filter((x) => x.severity === "block" && !ok.has(checkKey(x))).length;
  const commentary: Record<string, string> = {};
  for (const r of comm ?? []) commentary[`${r.period_key}|${r.section}`] = r.body;
  return {
    id: c.id, name: c.name, basePath: `/company/${c.id}`, source: c.source as CompanyBundle["source"],
    months, settings, alerts, accounts, commentary, readOnly: mem?.role === "viewer",
    lastUpdated: c.last_synced_at, orgName: org?.name, notes: (c.notes as string[]) ?? [],
    companies: list ?? [], aiEnabled: Boolean(process.env.ANTHROPIC_API_KEY),
    role: mem?.role ?? "viewer", orgId: c.org_id, dataVersion: c.data_version,
    accepted: accepted.map((a) => ({ title: a.title, period: a.period, reason: a.reason })), health: { failing }, asOf, assumptions: assumptionsFromRow(c),
  };
});

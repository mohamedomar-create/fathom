import { LOCATION_TYPES, type LocationType, type LocationTypes } from "@/lib/ingest/inventory";
import { cache } from "react";
import "server-only";
import { notFound } from "next/navigation";
import { isUuid } from "@/lib/ids";
import { logOp } from "@/lib/observe";
import type { Assumptions, ClassKey, ForecastDrivers, CompanySettings, Importance } from "@/lib/engine";
import { getUser } from "@/lib/supabase/server";
import type { CompanyRow } from "@/lib/supabase/database.types";
import { buildMonths, naturalAccounts, type StoredAccount } from "./build";
import type { AlertSetting, CompanyBundle } from "./types";

export interface KpiConfigEntry { active?: boolean; importance?: Importance; target?: number | null; alert_active?: boolean; alert_threshold?: number | null }
export type KpiConfig = Record<string, KpiConfigEntry>;
import { ECONOMY_KEY, FORECAST_KEY, INVENTORY_KEY, RESERVED_KEYS } from "./config-keys";
import { booksFromZeroOf, timeZoneOf } from "./time-zone";
export { ECONOMY_KEY, FORECAST_KEY, INVENTORY_KEY, RESERVED_KEYS };

export function forecastFromRow(c: Pick<CompanyRow, "kpi_config">): ForecastDrivers {
  const e = ((c.kpi_config ?? {}) as Record<string, unknown>)[FORECAST_KEY];
  return e && typeof e === "object" ? (e as ForecastDrivers) : {};
}

/** Inventory settings kept with the company (the rental location picked at upload). */
export function inventorySettingsFromRow(c: Pick<CompanyRow, "kpi_config">): { rentalLocation: string | null; locationTypes: LocationTypes } {
  const e = ((c.kpi_config ?? {}) as Record<string, unknown>)[INVENTORY_KEY] as { rentalLocation?: unknown; locationTypes?: unknown } | undefined;
  const types = e && e.locationTypes && typeof e.locationTypes === "object" ? Object.entries(e.locationTypes as Record<string, unknown>).filter((x): x is [string, LocationType] => LOCATION_TYPES.includes(x[1] as LocationType)) : [];
  return { rentalLocation: e && typeof e.rentalLocation === "string" && e.rentalLocation ? e.rentalLocation : null, locationTypes: Object.fromEntries(types) };
}

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
    if (RESERVED_KEYS.includes(k)) continue;
    if (v.target !== undefined) targets[k] = v.target;
    if (v.importance) importance[k] = v.importance;
    if (v.alert_active !== undefined) alerts[k] = { active: !!v.alert_active, threshold: v.alert_threshold ?? null };
    if (v.active !== undefined) anyActive = true;
  }
  if (anyActive) {
    // Only explicit entries are stored; defaults apply to the rest.
    for (const [k, v] of Object.entries(cfg)) if (!RESERVED_KEYS.includes(k) && v.active) active.push(k);
  }
  return {
    settings: { currency: c.currency, fyStartMonth: c.fy_start_month, taxRate: Number(c.tax_rate), targets, importance, activeKpis: anyActive ? withDefaults(active, cfg) : undefined },
    alerts,
  };
}

import { currentAsOf, KPI_DEFS } from "@/lib/engine";
import { loadBalances } from "./balances";
import { checkKey, runChecks } from "./checks";
import { accessFrom, AccessError } from "./access";
function withDefaults(active: string[], cfg: KpiConfig) {
  const set = new Set(active);
  for (const d of KPI_DEFS) if (cfg[d.key]?.active === undefined && d.defaultActive) set.add(d.key);
  return [...set];
}

export async function loadAccounts(supabase: Awaited<ReturnType<typeof getUser>>["supabase"], companyId: string, version: number): Promise<StoredAccount[]> {
  // The accounts and all balances of this version, read at the same time (see loadBalances).
  const [{ data: accts, error }, bal] = await Promise.all([
    supabase.from("source_accounts").select("id, code, name, class, sort_order").eq("company_id", companyId).eq("version", version).order("sort_order"),
    loadBalances(supabase, companyId, version),
  ]);
  if (error) throw error;
  const raw = new Map<string, Record<string, number>>((accts ?? []).map((a) => [a.id, {}]));
  for (const b of bal) {
    const r = raw.get(b.account_id);
    if (r) r[b.period] = Number(b.amount);
  }
  return (accts ?? []).map((a) => ({ id: a.id, code: a.code, name: a.name, cls: a.class as ClassKey, raw: raw.get(a.id) ?? {} }));
}

export const loadCompanyBundle = cache(async (id: string): Promise<CompanyBundle & { role: string; orgId: string; dataVersion: number }> => {
  if (!isUuid(id)) notFound();
  const t0 = Date.now();
  const { supabase, user } = await getUser();
  if (!user) notFound();
  const { data: c, error: cErr } = await supabase.from("companies").select("*").eq("id", id).maybeSingle();
  if (cErr) throw new AccessError(cErr.code);
  if (!c) notFound();
  // Everything else in one round, the accounts included.
  const [{ data: mem, error: memErr }, { data: org }, { data: list }, { data: comm }, { data: imp }, stored] = await Promise.all([
    supabase.from("memberships").select("role").eq("org_id", c.org_id).eq("user_id", user.id).maybeSingle(),
    supabase.from("organizations").select("name").eq("id", c.org_id).maybeSingle(),
    supabase.from("companies").select("id, name").eq("org_id", c.org_id).order("name"),
    supabase.from("commentary").select("period_key, section, body").eq("company_id", id),
    supabase.from("imports").select("report").eq("company_id", id).eq("data_version", c.data_version).eq("action", "import").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    loadAccounts(supabase, id, c.data_version),
  ]);
  // Fails closed: a membership that couldn't be read is an error, none means not this person's company.
  const access = accessFrom(mem, memErr);
  if (access === "none") notFound();
  const accounts = naturalAccounts(stored);
  const { settings, alerts } = settingsFromRow(c);
  const months = buildMonths(accounts);
  const report = (imp?.report ?? {}) as { accepted?: { key: string; title: string; period?: string; reason: string }[]; asOf?: string; unit?: number };
  const accepted = report.accepted ?? [];
  // Only the latest month can be a part month: an older import's stop day no longer applies once later months exist.
  const asOf = currentAsOf(report.asOf, months.map((m) => m.period)) ?? undefined;
  const ok = new Set(accepted.map((a) => a.key));
  const tChecks = Date.now();
  const unit = report.unit === 1000 || report.unit === 1_000_000 ? report.unit : 1;
  const failing = runChecks({ accounts, months, unit }).filter((x) => x.severity === "block" && !ok.has(checkKey(x))).length;
  const commentary: Record<string, string> = {};
  for (const r of comm ?? []) commentary[`${r.period_key}|${r.section}`] = r.body;
  logOp({ op: "company_bundle", company: id, ms: Date.now() - t0, attempts: 1, outcome: "ok", detail: `checks ${Date.now() - tChecks} ms, ${accounts.length} accounts, ${months.length} months` });
  return {
    id: c.id, name: c.name, basePath: `/company/${c.id}`, source: c.source as CompanyBundle["source"],
    months, settings, alerts, accounts, commentary, readOnly: access.readOnly,
    lastUpdated: c.last_synced_at, orgName: org?.name, notes: (c.notes as string[]) ?? [],
    companies: list ?? [], aiEnabled: Boolean(process.env.ANTHROPIC_API_KEY),
    role: access.role, orgId: c.org_id, dataVersion: c.data_version,
    accepted: accepted.map((a) => ({ title: a.title, period: a.period, reason: a.reason })), health: { failing }, asOf, unit, assumptions: assumptionsFromRow(c), forecast: forecastFromRow(c), inventorySettings: inventorySettingsFromRow(c), timeZone: timeZoneOf(c.kpi_config), booksFromZero: booksFromZeroOf(c.kpi_config),
  };
});

import "server-only";
import { analyze, currentAsOf, defaultEnd, hasPL, type Analysis, type MonthData } from "@/lib/engine";
import { getUser } from "@/lib/supabase/server";
import type { CompanyRow } from "@/lib/supabase/database.types";
import { buildMonths, naturalAccounts } from "./build";
import { loadSubMap } from "./account-map";
import { withSubClasses } from "@/lib/ingest/subclass";
import { loadAccounts, settingsFromRow } from "./load";
import type { PendingInvite } from "@/app/companies/pending-invites";

export interface PortfolioItem {
  company: CompanyRow;
  orgName: string;
  months: MonthData[];
  analysis: Analysis | null;
  /** How far the books go (the latest import), or null. */
  asOf: string | null;
}

export async function loadPortfolio(): Promise<{ items: PortfolioItem[]; orgs: { id: string; name: string; role: string }[]; email: string; invites: PendingInvite[] }> {
  const { supabase, user } = await getUser();
  if (!user) return { items: [], orgs: [], email: "", invites: [] };
  const [{ data: mems }, { data: companies }, { data: invites }] = await Promise.all([
    supabase.from("memberships").select("org_id, role, organizations(name)").eq("user_id", user.id),
    supabase.from("companies").select("*").order("name"),
    supabase.rpc("my_invites"),
  ]);
  // How far each company's books go (its current version's latest import), so a part month is treated as on its own pages.
  const asOfOf = async (id: string, version: number) => {
    const { data } = await supabase.from("imports").select("report").eq("company_id", id).eq("data_version", version).eq("action", "import").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const r = data?.report as { asOf?: string } | null | undefined;
    return typeof r?.asOf === "string" ? r.asOf : null;
  };
  const orgs = (mems ?? []).map((m) => ({ id: m.org_id, role: m.role, name: (m.organizations as unknown as { name: string } | null)?.name ?? "Organisation" }));
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const items = await Promise.all((companies ?? []).map(async (c) => {
    const [stored, subMap] = await Promise.all([loadAccounts(supabase, c.id, c.data_version), loadSubMap(supabase, c.id)]);
    const months = buildMonths(withSubClasses(naturalAccounts(stored), subMap));
    const { settings, alerts } = settingsFromRow(c);
    // The month the company's pages open on: the last full month that has a P&L.
    const asOf = currentAsOf(await asOfOf(c.id, c.data_version), months.map((m) => m.period));
    const end = defaultEnd(months.filter(hasPL).map((m) => m.period), asOf);
    let analysis: Analysis | null = null;
    try { analysis = end ? analyze(months, { type: "month", end }, settings, { alerts, asOf }) : null; } catch { analysis = null; }
    return { company: c, orgName: orgName.get(c.org_id) ?? "", months, analysis, asOf };
  }));
  return { items, orgs, email: user.email ?? "", invites: Array.isArray(invites) ? (invites as unknown as PendingInvite[]) : [] };
}

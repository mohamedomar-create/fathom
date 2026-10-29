import "server-only";
import { analyze, defaultEnd, hasPL, type Analysis, type MonthData } from "@/lib/engine";
import { getUser } from "@/lib/supabase/server";
import type { CompanyRow } from "@/lib/supabase/database.types";
import { buildMonths, naturalAccounts } from "./build";
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
  const [{ data: mems }, { data: companies }, { data: invites }, { data: imports }] = await Promise.all([
    supabase.from("memberships").select("org_id, role, organizations(name)").eq("user_id", user.id),
    supabase.from("companies").select("*").order("name"),
    supabase.rpc("my_invites"),
    // How far each company's books go (its latest import), so a part month is treated as on the company's own pages.
    supabase.from("imports").select("company_id, data_version, report").eq("action", "import").order("created_at", { ascending: false }).limit(500),
  ]);
  const asOfOf = (id: string, version: number) => {
    const r = (imports ?? []).find((i) => i.company_id === id && i.data_version === version)?.report as { asOf?: string } | null | undefined;
    return typeof r?.asOf === "string" ? r.asOf : null;
  };
  const orgs = (mems ?? []).map((m) => ({ id: m.org_id, role: m.role, name: (m.organizations as unknown as { name: string } | null)?.name ?? "Organisation" }));
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const items = await Promise.all((companies ?? []).map(async (c) => {
    const months = buildMonths(naturalAccounts(await loadAccounts(supabase, c.id, c.data_version)));
    const { settings, alerts } = settingsFromRow(c);
    // The month the company's pages open on: the last full month that has a P&L.
    const asOf = asOfOf(c.id, c.data_version);
    const end = defaultEnd(months.filter(hasPL).map((m) => m.period), asOf);
    let analysis: Analysis | null = null;
    try { analysis = end ? analyze(months, { type: "month", end }, settings, { alerts, asOf }) : null; } catch { analysis = null; }
    return { company: c, orgName: orgName.get(c.org_id) ?? "", months, analysis, asOf };
  }));
  return { items, orgs, email: user.email ?? "", invites: Array.isArray(invites) ? (invites as unknown as PendingInvite[]) : [] };
}

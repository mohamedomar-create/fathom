import "server-only";
import { analyze, type Analysis, type MonthData } from "@/lib/engine";
import { getUser } from "@/lib/supabase/server";
import type { CompanyRow } from "@/lib/supabase/database.types";
import { buildMonths, naturalAccounts } from "./build";
import { loadAccounts, settingsFromRow } from "./load";

export interface PortfolioItem {
  company: CompanyRow;
  orgName: string;
  months: MonthData[];
  analysis: Analysis | null;
}

export async function loadPortfolio(): Promise<{ items: PortfolioItem[]; orgs: { id: string; name: string; role: string }[]; email: string }> {
  const { supabase, user } = await getUser();
  if (!user) return { items: [], orgs: [], email: "" };
  await supabase.rpc("accept_pending_invites"); // invites sent after this user signed up
  const [{ data: mems }, { data: companies }] = await Promise.all([
    supabase.from("memberships").select("org_id, role, organizations(name)").eq("user_id", user.id),
    supabase.from("companies").select("*").order("name"),
  ]);
  const orgs = (mems ?? []).map((m) => ({ id: m.org_id, role: m.role, name: (m.organizations as unknown as { name: string } | null)?.name ?? "Organisation" }));
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const items = await Promise.all((companies ?? []).map(async (c) => {
    const months = buildMonths(naturalAccounts(await loadAccounts(supabase, c.id, c.data_version)));
    const { settings, alerts } = settingsFromRow(c);
    const last = months[months.length - 1]?.period;
    let analysis: Analysis | null = null;
    try { analysis = last ? analyze(months, { type: "month", end: last }, settings, { alerts }) : null; } catch { analysis = null; }
    return { company: c, orgName: orgName.get(c.org_id) ?? "", months, analysis };
  }));
  return { items, orgs, email: user.email ?? "" };
}

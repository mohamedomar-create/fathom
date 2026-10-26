import { getUser } from "@/lib/supabase/server";
import { getDict } from "@/lib/i18n/server";
import { DeleteOrg } from "./delete-org";
import { OrgForm } from "./org-form";
import { RecentlyDeleted, type Deleted } from "./recently-deleted";
import { AiAllowance } from "./ai-allowance";

export default async function OrgPage() {
  const { supabase, user } = await getUser();
  const { data: m } = await supabase.from("memberships").select("org_id").eq("user_id", user!.id).eq("role", "admin").order("created_at").limit(1).maybeSingle();
  // Not an admin anywhere: the layout explains; this page renders nothing (it runs alongside the layout).
  if (!m) return null;
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const [{ data: o }, { count: companies }, { count: members }, { data: gone }, { data: use }] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", m.org_id).single(),
    supabase.from("companies").select("id", { count: "exact", head: true }).eq("org_id", m.org_id),
    supabase.from("memberships").select("user_id", { count: "exact", head: true }).eq("org_id", m.org_id),
    supabase.rpc("deleted_items"),
    supabase.from("ai_usage").select("micros").eq("org_id", m.org_id).gte("at", monthStart),
  ]);
  const usedMicros = (use ?? []).reduce((t, r) => t + Number(r.micros), 0);
  const g = (gone ?? {}) as { companies?: Omit<Deleted, "kind">[]; orgs?: Omit<Deleted, "kind">[] };
  const deleted: Deleted[] = [...(g.companies ?? []).map((x) => ({ ...x, kind: "company" as const })), ...(g.orgs ?? []).map((x) => ({ ...x, kind: "org" as const }))];
  const d = (await getDict()).account;
  return (
    <div>
      <h1 className="mb-1 text-3xl font-light">{d.orgProfile}</h1>
      <p className="mb-6 text-mute">{d.orgProfileHelp}</p>
      <OrgForm org={o!} />
      <AiAllowance orgId={o!.id} usd={Number(o!.ai_monthly_usd ?? 20)} usedMicros={usedMicros} isOwner={o!.owner_id === user!.id} />
      <RecentlyDeleted items={deleted} />
      {o!.owner_id === user!.id && <DeleteOrg orgId={o!.id} name={o!.name} companies={companies ?? 0} members={members ?? 0} />}
    </div>
  );
}

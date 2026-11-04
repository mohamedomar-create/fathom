import { getUser } from "@/lib/supabase/server";
import { adminOrgs } from "@/lib/admin/org";
import { getDict } from "@/lib/i18n/server";
import { DeleteOrg } from "./delete-org";
import { OrgForm } from "./org-form";
import { RecentlyDeleted, type Deleted } from "./recently-deleted";
import { AiAllowance } from "./ai-allowance";

export default async function OrgPage() {
  const { supabase, user } = await getUser();
  const m = (await adminOrgs()).current;
  // Not an admin anywhere: the layout explains; this page renders nothing (it runs alongside the layout).
  if (!m) return null;
  const [{ data: o }, { count: companies }, { count: members }, { data: gone }, { data: use }] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", m.org_id).single(),
    supabase.from("companies").select("id", { count: "exact", head: true }).eq("org_id", m.org_id),
    supabase.from("memberships").select("user_id", { count: "exact", head: true }).eq("org_id", m.org_id),
    supabase.rpc("deleted_items"),
    supabase.rpc("ai_usage_month", { p_org: m.org_id }),
  ]);
  const usedMicros = Number(use ?? 0);
  const g = (gone ?? {}) as { companies?: Omit<Deleted, "kind">[]; orgs?: Omit<Deleted, "kind">[] };
  const deleted: Deleted[] = [...(g.companies ?? []).map((x) => ({ ...x, kind: "company" as const })), ...(g.orgs ?? []).map((x) => ({ ...x, kind: "org" as const }))];
  const d = (await getDict()).account;
  return (
    <div>
      <h1 className="mb-1 text-3xl font-light">{d.orgProfile}</h1>
      <p className="mb-6 text-mute">{d.orgProfileHelp}</p>
      <OrgForm key={o!.id} org={o!} />
      <AiAllowance orgId={o!.id} usd={Number(o!.ai_monthly_usd ?? 20)} usedMicros={usedMicros} isOwner={o!.owner_id === user!.id} />
      <RecentlyDeleted items={deleted} />
      {o!.owner_id === user!.id && <DeleteOrg orgId={o!.id} name={o!.name} companies={companies ?? 0} members={members ?? 0} />}
    </div>
  );
}

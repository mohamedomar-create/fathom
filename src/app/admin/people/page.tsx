import { getUser } from "@/lib/supabase/server";
import { adminOrgs } from "@/lib/admin/org";
import { getDict } from "@/lib/i18n/server";
import { PeopleManager } from "./people-manager";
import { CompanyAccess } from "./company-access";

export default async function PeoplePage() {
  const { supabase, user } = await getUser();
  const m = (await adminOrgs()).current;
  // Not an admin anywhere: the layout explains; this page renders nothing (it runs alongside the layout).
  if (!m) return null;
  const orgId = m.org_id;
  const [{ data: members }, { data: invites }, { data: org }, { data: companies }, { data: roles }] = await Promise.all([
    supabase.from("memberships").select("user_id, role, created_at").eq("org_id", orgId),
    supabase.from("invites").select("id, email, role, created_at, expires_at, declined_at").eq("org_id", orgId).is("accepted_at", null),
    supabase.from("organizations").select("owner_id").eq("id", orgId).maybeSingle(),
    supabase.from("companies").select("id, name").eq("org_id", orgId).order("name"),
    supabase.from("company_roles").select("company_id, user_id, role, companies!inner(org_id)").eq("companies.org_id", orgId),
  ]);
  const { data: profiles } = await supabase.from("profiles").select("id, email, full_name").in("id", (members ?? []).map((x) => x.user_id));
  const people = (members ?? []).map((x) => ({ ...x, email: profiles?.find((p) => p.id === x.user_id)?.email ?? "", name: profiles?.find((p) => p.id === x.user_id)?.full_name ?? null }));
  const d = (await getDict()).account;
  return (
    <div>
      <h1 className="mb-1 text-3xl font-light">{d.people}</h1>
      <p className="mb-6 text-mute">{d.peopleHelp}</p>
      <PeopleManager orgId={orgId} me={user!.id} ownerId={org?.owner_id ?? null} people={people} invites={invites ?? []} />
      <CompanyAccess companies={companies ?? []} roles={(roles ?? []).map((r) => ({ company_id: r.company_id, user_id: r.user_id, role: r.role }))}
        people={people.filter((p) => p.user_id !== org?.owner_id).map((p) => ({ userId: p.user_id, label: p.name ? `${p.name} (${p.email})` : p.email, role: p.role }))} />
    </div>
  );
}

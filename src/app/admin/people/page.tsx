import { getUser } from "@/lib/supabase/server";
import { getDict } from "@/lib/i18n/server";
import { PeopleManager } from "./people-manager";

export default async function PeoplePage() {
  const { supabase, user } = await getUser();
  const { data: m } = await supabase.from("memberships").select("org_id").eq("user_id", user!.id).eq("role", "admin").order("created_at").limit(1).maybeSingle();
  // Not an admin anywhere: the layout explains; this page renders nothing (it runs alongside the layout).
  if (!m) return null;
  const orgId = m.org_id;
  const [{ data: members }, { data: invites }, { data: org }] = await Promise.all([
    supabase.from("memberships").select("user_id, role, created_at").eq("org_id", orgId),
    supabase.from("invites").select("id, email, role, created_at, expires_at, declined_at").eq("org_id", orgId).is("accepted_at", null),
    supabase.from("organizations").select("owner_id").eq("id", orgId).maybeSingle(),
  ]);
  const { data: profiles } = await supabase.from("profiles").select("id, email, full_name").in("id", (members ?? []).map((x) => x.user_id));
  const people = (members ?? []).map((x) => ({ ...x, email: profiles?.find((p) => p.id === x.user_id)?.email ?? "", name: profiles?.find((p) => p.id === x.user_id)?.full_name ?? null }));
  const d = (await getDict()).account;
  return (
    <div>
      <h1 className="mb-1 text-3xl font-light">{d.people}</h1>
      <p className="mb-6 text-mute">{d.peopleHelp}</p>
      <PeopleManager orgId={orgId} me={user!.id} ownerId={org?.owner_id ?? null} people={people} invites={invites ?? []} />
    </div>
  );
}

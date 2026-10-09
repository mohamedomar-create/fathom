import { getUser } from "@/lib/supabase/server";
import { PeopleManager } from "./people-manager";

export default async function PeoplePage() {
  const { supabase, user } = await getUser();
  const { data: m } = await supabase.from("memberships").select("org_id").eq("user_id", user!.id).eq("role", "admin").order("created_at").limit(1).single();
  const orgId = m!.org_id;
  const [{ data: members }, { data: invites }] = await Promise.all([
    supabase.from("memberships").select("user_id, role, created_at").eq("org_id", orgId),
    supabase.from("invites").select("id, email, role, created_at").eq("org_id", orgId).is("accepted_at", null),
  ]);
  const { data: profiles } = await supabase.from("profiles").select("id, email, full_name").in("id", (members ?? []).map((x) => x.user_id));
  const people = (members ?? []).map((x) => ({ ...x, email: profiles?.find((p) => p.id === x.user_id)?.email ?? "", name: profiles?.find((p) => p.id === x.user_id)?.full_name ?? null }));
  return (
    <div>
      <h1 className="mb-1 text-3xl font-light">User management</h1>
      <p className="mb-6 text-mute">Invite colleagues. They join this organisation automatically when they sign up with the invited email address.</p>
      <PeopleManager orgId={orgId} me={user!.id} people={people} invites={invites ?? []} />
    </div>
  );
}

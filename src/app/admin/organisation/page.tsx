import { getUser } from "@/lib/supabase/server";
import { DeleteOrg } from "./delete-org";
import { OrgForm } from "./org-form";

export default async function OrgPage() {
  const { supabase, user } = await getUser();
  const { data: m } = await supabase.from("memberships").select("org_id").eq("user_id", user!.id).eq("role", "admin").order("created_at").limit(1).single();
  const [{ data: o }, { count: companies }, { count: members }] = await Promise.all([
    supabase.from("organizations").select("*").eq("id", m!.org_id).single(),
    supabase.from("companies").select("id", { count: "exact", head: true }).eq("org_id", m!.org_id),
    supabase.from("memberships").select("user_id", { count: "exact", head: true }).eq("org_id", m!.org_id),
  ]);
  return (
    <div>
      <h1 className="mb-1 text-3xl font-light">Organisation profile</h1>
      <p className="mb-6 text-mute">Your firm&apos;s name, branding and the disclaimer printed on every report.</p>
      <OrgForm org={o!} />
      <DeleteOrg orgId={o!.id} name={o!.name} companies={companies ?? 0} members={members ?? 0} />
    </div>
  );
}

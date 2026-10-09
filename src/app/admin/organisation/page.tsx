import { getUser } from "@/lib/supabase/server";
import { OrgForm } from "./org-form";

export default async function OrgPage() {
  const { supabase, user } = await getUser();
  const { data: m } = await supabase.from("memberships").select("org_id").eq("user_id", user!.id).eq("role", "admin").limit(1).single();
  const { data: o } = await supabase.from("organizations").select("*").eq("id", m!.org_id).single();
  return (
    <div>
      <h1 className="mb-1 text-3xl font-light">Organisation profile</h1>
      <p className="mb-6 text-mute">Your firm&apos;s name, branding and the disclaimer printed on every report.</p>
      <OrgForm org={o!} />
    </div>
  );
}

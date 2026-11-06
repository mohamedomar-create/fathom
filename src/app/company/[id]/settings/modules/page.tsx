import { getUser } from "@/lib/supabase/server";
import { loadCompanyBundle } from "@/lib/company/load";
import { ModulesSettings } from "@/components/settings/modules-settings";

/** Settings ▸ Modules: which areas the company brings, the modules it built, and who sees each one. */
export default async function ModulesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await loadCompanyBundle(id);
  const { supabase } = await getUser();
  // The organisation's people, for modules shared with named people (admins only see and change this).
  const people: { userId: string; label: string }[] = [];
  if (c.role === "admin") {
    const { data: members } = await supabase.from("memberships").select("user_id").eq("org_id", c.orgId);
    const ids = (members ?? []).map((m) => m.user_id);
    const { data: profiles } = ids.length ? await supabase.from("profiles").select("id, email, full_name").in("id", ids) : { data: [] };
    for (const p of profiles ?? []) people.push({ userId: p.id, label: p.full_name ? `${p.full_name} (${p.email})` : p.email });
  }
  return <ModulesSettings people={people} />;
}

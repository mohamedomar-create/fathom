import { getUser } from "@/lib/supabase/server";
import { ProfileForm } from "@/components/settings/profile-form";

export default async function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  const { data: c } = await supabase.from("companies").select("id, org_id, name, currency, fy_start_month, tax_rate, industry, ai_context").eq("id", id).single();
  const { data: m } = await supabase.from("memberships").select("role").eq("org_id", c!.org_id).eq("user_id", user!.id).maybeSingle();
  return (
    <div>
      <div className="label">3 · Company Profile</div>
      <h1 className="mb-6 text-3xl font-light">Company Profile</h1>
      <ProfileForm initial={{ ...c!, tax_rate: Number(c!.tax_rate), ai_context: (c!.ai_context ?? {}) as Record<string, string> }} readOnly={m?.role === "viewer"} canDelete={m?.role === "admin"} />
    </div>
  );
}

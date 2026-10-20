import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { ProfileForm } from "@/components/settings/profile-form";
import { booksStartOf, timeZoneOf } from "@/lib/company/time-zone";
import { parseResetPreview } from "@/lib/company/reset";

export default async function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  const { data: c } = await supabase.from("companies").select("id, org_id, name, currency, fy_start_month, tax_rate, industry, ai_context, kpi_config").eq("id", id).maybeSingle();
  // The company was just deleted (this page is drawn again after the action) or is not the person's: back to the list.
  if (!c) redirect("/companies");
  const [{ data: m }, { data: preview }] = await Promise.all([
    supabase.from("memberships").select("role").eq("org_id", c.org_id).eq("user_id", user!.id).maybeSingle(),
    // What each module holds (migration 0031); without it the page keeps the plain delete.
    supabase.rpc("data_reset_preview", { p_company: id }),
  ]);
  return (
    <div>
      <div className="label">1 · Company Profile</div>
      <h1 className="mb-6 text-3xl font-light">Company Profile</h1>
      <ProfileForm initial={{ id: c.id, name: c.name, currency: c.currency, fy_start_month: c.fy_start_month, industry: c.industry, tax_rate: Number(c.tax_rate), ai_context: (c.ai_context ?? {}) as Record<string, string>, time_zone: timeZoneOf(c.kpi_config), books_start: booksStartOf(c.kpi_config) }} readOnly={m?.role === "viewer"} canDelete={m?.role === "admin"} role={m?.role} reset={parseResetPreview(preview)} />
    </div>
  );
}

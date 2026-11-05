import { getDict } from "@/lib/i18n/server";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { ProfileForm } from "@/components/settings/profile-form";
import { booksStartOf, timeZoneOf, vatMeasuredOf, vatRateSetOf } from "@/lib/company/time-zone";
import { parseResetPreview, resetUnavailable } from "@/lib/company/reset";
import { companyRole } from "@/lib/company/role";

export default async function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const heading = (await getDict()).settingsNav.items["profile"]?.[0] ?? "Company Profile";
  const { id } = await params;
  const { supabase } = await getUser();
  const { data: c } = await supabase.from("companies").select("id, org_id, name, currency, fy_start_month, tax_rate, industry, ai_context, kpi_config").eq("id", id).maybeSingle();
  // The company was just deleted (this page is drawn again after the action) or is not the person's: back to the list.
  if (!c) redirect("/companies");
  const [role, { data: preview, error: previewError }] = await Promise.all([
    companyRole(supabase, id),
    // What each module holds (migration 0031); without it the page keeps the plain delete.
    supabase.rpc("data_reset_preview", { p_company: id }),
  ]);
  return (
    <div>
      <div className="label">1 · {heading}</div>
      <h1 className="mb-6 text-3xl font-light">{heading}</h1>
      <ProfileForm initial={{ id: c.id, name: c.name, currency: c.currency, fy_start_month: c.fy_start_month, industry: c.industry, tax_rate: Number(c.tax_rate), ai_context: (c.ai_context ?? {}) as Record<string, string>, time_zone: timeZoneOf(c.kpi_config), books_start: booksStartOf(c.kpi_config), vat_rate: vatRateSetOf(c.kpi_config) ?? null, vat_measured: vatMeasuredOf(c.kpi_config) }} readOnly={role !== "editor" && role !== "admin"} canDelete={role === "admin"} role={role ?? undefined} reset={parseResetPreview(preview)} resetNote={resetUnavailable(previewError)} />
    </div>
  );
}

import { getDict } from "@/lib/i18n/server";
import { ProfileForm } from "@/components/settings/profile-form";
import { demoCompany } from "@/lib/company/demo";

export default async function DemoProfile() {
  const dict = await getDict();
  const heading = dict.settingsNav.items["profile"]?.[0] ?? "Company Profile";
  const p = dict.setx.profile;
  const d = demoCompany();
  return (
    <div>
      <div className="label">1 · {heading}</div>
      <h1 className="mb-6 text-3xl font-light">{heading}</h1>
      <ProfileForm readOnly canDelete={false} canExport={false} initial={{ id: d.id, name: d.name, currency: d.settings.currency, fy_start_month: d.settings.fyStartMonth, tax_rate: d.settings.taxRate, industry: p.demoIndustry,
        ai_context: { goals: p.demoGoals, strategy: p.demoStrategy, market: "", position: "", other: "" } }} />
    </div>
  );
}

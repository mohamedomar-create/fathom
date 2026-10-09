import { ProfileForm } from "@/components/settings/profile-form";
import { demoCompany } from "@/lib/company/demo";

export default function DemoProfile() {
  const d = demoCompany();
  return (
    <div>
      <div className="label">2 · Company Profile</div>
      <h1 className="mb-6 text-3xl font-light">Company Profile</h1>
      <ProfileForm readOnly canDelete={false} initial={{ id: d.id, name: d.name, currency: d.settings.currency, fy_start_month: d.settings.fyStartMonth, tax_rate: d.settings.taxRate, industry: "Wholesale trading",
        ai_context: { goals: "Grow revenue above EGP 1.1M a month while holding gross margin at 45%.", strategy: "Expand service revenue; tighten supplier terms.", market: "", position: "", other: "" } }} />
    </div>
  );
}

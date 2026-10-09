import { KpiConfigForm } from "@/components/settings/kpi-config-form";

export default function Page() {
  return (
    <div>
      <div className="label">4 · KPIs</div>
      <h1 className="mb-6 text-3xl font-light">KPIs</h1>
      <KpiConfigForm mode="kpis" />
    </div>
  );
}

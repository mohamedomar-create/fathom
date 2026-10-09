import { KpiConfigForm } from "@/components/settings/kpi-config-form";

export default function Page() {
  return (
    <div>
      <div className="label">6 · Alerts</div>
      <h1 className="mb-6 text-3xl font-light">Alerts</h1>
      <KpiConfigForm mode="alerts" />
    </div>
  );
}

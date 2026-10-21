import { getDict } from "@/lib/i18n/server";
import { KpiConfigForm } from "@/components/settings/kpi-config-form";

export default async function Page() {
  const heading = (await getDict()).settingsNav.items["alerts"]?.[0] ?? "Alerts";
  return (
    <div>
      <div className="label">5 · {heading}</div>
      <h1 className="mb-6 text-3xl font-light">{heading}</h1>
      <KpiConfigForm mode="alerts" />
    </div>
  );
}

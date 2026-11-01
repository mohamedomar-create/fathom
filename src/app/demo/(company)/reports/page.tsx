import { ReportBuilder } from "@/components/report/report-builder";
import { DEFAULT_SECTIONS } from "@/lib/report/types";
import { getDict } from "@/lib/i18n/server";

export default async function DemoReport() {
  const t = (await getDict()).rep.b;
  return (
    <ReportBuilder demo
      report={{ id: "demo", title: "Monthly Performance Report", period_type: "month", period_end: "2026-09", sections: DEFAULT_SECTIONS, status: "draft", share_token: null }}
      org={{ name: t.demoOrg, logoUrl: null, brandColour: "#0B6E70", footer: null, disclaimer: t.demoDisclaimer }}
    />
  );
}

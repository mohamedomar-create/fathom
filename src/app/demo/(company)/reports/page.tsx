import { ReportBuilder } from "@/components/report/report-builder";
import { DEFAULT_SECTIONS } from "@/lib/report/types";

export default function DemoReport() {
  return (
    <ReportBuilder demo
      report={{ id: "demo", title: "Monthly Performance Report", period_type: "month", period_end: "2026-09", sections: DEFAULT_SECTIONS, status: "draft", share_token: null }}
      org={{ name: "Demo Advisory", logoUrl: null, brandColour: "#0B6E70", footer: null, disclaimer: "This report has been prepared from unaudited financial information provided by management. No opinion is expressed on its accuracy." }}
    />
  );
}

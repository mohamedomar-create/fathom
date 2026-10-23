import { SimpleProvider } from "@/lib/company/simple-context";
import { loadSimpleLines } from "@/lib/company/simple-load";
import { loadCompanyMeta } from "@/lib/company/meta";
import { timeZoneOf } from "@/lib/company/time-zone";
import { ModuleGate } from "@/components/shell/module-state";
import { statusOf } from "@/lib/company/loaded";

/** Today in the company's time zone (Cairo when none is set): the day ageing and burn are counted to. */
function today(tz: string | null) {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz ?? "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
  catch { return new Date().toISOString().slice(0, 10); }
}

export default async function SimpleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [meta, lines] = await Promise.all([loadCompanyMeta(id), loadSimpleLines(id)]);
  // A failed read shows as failed (with a retry), never as "no sales or expenses yet".
  return (
    <ModuleGate module="lines" state={statusOf(lines, lines.status !== "empty")}>
      <SimpleProvider value={{ lines: lines.data, asOf: today(timeZoneOf(meta.kpiConfig)) }}>{children}</SimpleProvider>
    </ModuleGate>
  );
}
export const maxDuration = 60;

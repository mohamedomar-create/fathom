import { loadSimpleLines } from "@/lib/company/simple-load";
import { ModuleGate } from "@/components/shell/module-state";
import { statusOf } from "@/lib/company/loaded";
import { LinesTable } from "@/components/simple/lines-table";

export default async function DataLinesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lines = await loadSimpleLines(id);
  return <ModuleGate module="lines" state={statusOf(lines, lines.status !== "empty")}><LinesTable lines={lines.data} /></ModuleGate>;
}
export const maxDuration = 60;

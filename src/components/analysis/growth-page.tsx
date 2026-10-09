"use client";
import { useMemo, useState } from "react";
import { bsCalc, mlabel, plCalc, quadrantOf, QUADRANT_TEXT } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { useComments, useAnalysis } from "@/lib/company/use-period";
import { PageHeader } from "@/components/shell/page-header";
import { PeriodPicker } from "@/components/shell/period-picker";
import { SentenceSelect } from "@/components/ui/sentence-select";
import { GrowthQuadrant, QuadrantMiniMap } from "@/components/charts/growth-quadrant";
import { EmptyState, Notes } from "./common";

export function GrowthPage() {
  const c = useCompany();
  const a = useAnalysis();
  const comments = useComments();
  const end = a?.view.window.end ?? "";
  const avail = useMemo(() => c.months.map((m) => m.period).sort().filter((p) => p <= end), [c.months, end]);
  const [startSel, setStart] = useState<string | null>(null);
  if (!a) return null;
  const defaultStart = avail[Math.max(0, avail.length - 13)];
  const start = startSel && avail.includes(startSel) ? startSel : defaultStart;
  const byP = new Map(c.months.map((m) => [m.period, m]));
  const pts = avail.filter((p) => p >= start).map((p) => {
    const m = byP.get(p)!;
    return { label: mlabel(p), x: bsCalc(m.bs).toi, y: plCalc(m.pl).ebit };
  });
  const q = pts.length > 1 ? quadrantOf(pts[pts.length - 1].x, pts[pts.length - 1].y, pts[0].x, pts[0].y) : null;
  return (
    <>
      <PageHeader title="Growth" right={<PeriodPicker mode="upto" allowTypes={false} />}>
        <div className="sent">Comparing <b>EBIT vs Total Operating Investment</b> from{" "}
          <SentenceSelect value={start} onChange={setStart} options={avail.slice(0, -1).map((p) => ({ value: p, label: mlabel(p) }))} />
        </div>
      </PageHeader>
      {pts.length < 2 ? <EmptyState title="Not enough history" text="The growth view needs at least two months." /> : (
        <div className="grid items-start gap-8 lg:grid-cols-[1fr_200px]">
          <div data-testid="growth-chart"><GrowthQuadrant points={pts} cur={c.settings.currency} /></div>
          <div className="space-y-4">
            {q && <QuadrantMiniMap active={q} />}
            {q && <div><div className="label">Now in</div><div className="text-lg font-medium">{q}</div><p className="text-[13px] text-mute">{QUADRANT_TEXT[q]}</p></div>}
            <p className="text-xs text-mute">Each dot is one month. The quadrants are split at the starting month ({mlabel(start)}). Operating investment = receivables + stock + WIP − payables + fixed assets.</p>
          </div>
        </div>
      )}
      <Notes findings={[]} comment={comments("growth")} />
    </>
  );
}

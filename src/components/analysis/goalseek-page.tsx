"use client";
import { Info, RotateCcw } from "lucide-react";
import { useState } from "react";
import { applyChanges, currentRatio, GOAL_KPIS, goalseekTable, pct, type GoalKpi, type LeverKey } from "@/lib/engine";
import { useComments, useAnalysis } from "@/lib/company/use-period";
import { PageHeader } from "@/components/shell/page-header";
import { PeriodPicker } from "@/components/shell/period-picker";
import { SentenceSelect } from "@/components/ui/sentence-select";
import { Tip } from "@/components/ui/tooltip";
import { EmptyState, Notes } from "./common";

export function GoalseekPage() {
  const a = useAnalysis();
  const comments = useComments();
  const [kpi, setKpi] = useState<GoalKpi>("profit_ratio");
  const [goalOverride, setGoal] = useState<number | null>(null);
  const [changes, setChanges] = useState<Partial<Record<LeverKey, number>>>({});
  if (!a) return null;
  const P = a.view.P;
  const start = currentRatio(P, kpi);
  const tgt = a.targets[kpi] ?? 15;
  const stretch = start !== null && start >= tgt;
  const goal = goalOverride ?? (stretch ? Math.ceil((start! + 0.01) / 5) * 5 + (Math.ceil((start! + 0.01) / 5) * 5 - start! < 2 ? 5 : 0) : tgt);
  if (start === null) return (<><PageHeader title="Goalseek" right={<PeriodPicker />} /><EmptyState title="No revenue in this period" text="Goalseek needs revenue to work out the changes required." /></>);
  const now = applyChanges(P, kpi, changes) ?? start;
  const table = goalseekTable(P, kpi, goal);
  const bands = ["HIGH SENSITIVITY", "MEDIUM SENSITIVITY", "LOW SENSITIVITY"] as const;
  const reached = start >= goal;
  const span = Math.abs(goal - start) || 1;
  const progress = Math.max(0, Math.min(1.15, (now - start) / (goal - start || 1)));
  const name = GOAL_KPIS.find((g) => g.key === kpi)!.name;
  return (
    <>
      <PageHeader title="Goalseek" right={<PeriodPicker />}>
        <div className="sent flex flex-wrap items-center gap-1">
          Changes required to increase{" "}
          <SentenceSelect value={kpi} onChange={(v) => { setKpi(v); setGoal(null); setChanges({}); }} options={GOAL_KPIS.map((g) => ({ value: g.key, label: g.name }))} />
          {" "}from {pct(start)} to{" "}
          <span className="inline-flex items-center border-b border-dashed border-[#999] font-semibold text-ink">
            <input aria-label="Goal %" data-testid="goal-input" type="number" step="0.5" value={goal} onChange={(e) => setGoal(Number(e.target.value))} className="w-14 bg-transparent text-right outline-none" />%
          </span>
        </div>
      </PageHeader>
      <div className="mb-2 flex items-center gap-3 text-[11px] font-bold tracking-wider">
        <span className="w-24 shrink-0">START {pct(start)}</span>
        <div className="relative h-7 flex-1 border border-line" style={{ background: "repeating-linear-gradient(45deg,#f3f3f0,#f3f3f0 6px,#e9e9e5 6px,#e9e9e5 12px)" }}>
          <div className="absolute inset-y-0 left-0 bg-brand/30 transition-all" style={{ width: `${Math.min(progress, 1) * 100}%` }} />
          <div className="absolute -top-6 -translate-x-1/2 whitespace-nowrap rounded bg-bar px-1.5 py-0.5 text-[10px] text-white transition-all" style={{ left: `${Math.min(progress, 1) * 100}%` }} data-testid="now-marker">
            NOW {pct(now)}
          </div>
          <div className="absolute inset-y-0 w-0.5 bg-bar transition-all" style={{ left: `${Math.min(progress, 1) * 100}%` }} />
        </div>
        <span className="w-24 shrink-0 text-right">GOAL {pct(goal)}</span>
      </div>
      <p className="mb-2 mt-3 text-xs text-mute">
        Each bar = the % change in that one item alone that would reach the goal (others unchanged). Type a change in any row to see the combined effect on {name}.
        {stretch && goalOverride === null && ` The ${pct(tgt)} target is already met, so a stretch goal is shown — edit it above.`}
        {reached && " The goal is already reached — negative bars show how far each item could move before the ratio falls back to the goal."}
      </p>
      {Object.values(changes).some((v) => v) && (
        <button onClick={() => setChanges({})} className="mb-2 inline-flex items-center gap-1 text-xs text-brand-d hover:underline"><RotateCcw className="h-3 w-3" /> Reset changes</button>
      )}
      {bands.map((band) => {
        const items = table.filter((t) => t.band === band && !(t.needed === null && (kpi === "gpm" || kpi === "opm") && ["other_income", "other_expenses", "exp_fixed", "exp_variable"].includes(t.key) && P[t.key as "exp_fixed"] === 0));
        if (!items.length) return null;
        const lim = Math.max(10, ...items.map((t) => Math.abs(t.needed ?? 0))) * 1.15;
        return (
          <div key={band}>
            <div className="label mb-1 mt-6 text-center">{band} (axis ±{Math.round(lim).toLocaleString("en-GB")}%)</div>
            {items.map((t) => {
              const v = t.needed;
              const w = v === null ? 0 : Math.min((Math.abs(v) / lim) * 50, 50);
              return (
                <div key={t.key} className="grid grid-cols-[110px_1fr_70px_84px] items-center gap-3 border-b border-line py-2 sm:grid-cols-[160px_1fr_90px_100px]" data-testid={`lever-${t.key}`}>
                  <div className="flex items-center gap-1.5 text-[13px]">{t.name}{t.info && <Tip label={t.info} side="top"><Info className="h-3.5 w-3.5 text-mute" /></Tip>}</div>
                  <div className="relative h-3 bg-[#F4F4F1]">
                    <div className="absolute -inset-y-1 left-1/2 w-px bg-[#bbb]" />
                    {v !== null && <div className="absolute inset-y-0 opacity-70 transition-all" style={{ left: `${v >= 0 ? 50 : 50 - w}%`, width: `${w}%`, background: t.colour }} />}
                  </div>
                  <div className="num text-right text-[13px]">{v === null ? "–" : pct(v)}</div>
                  <label className="flex items-center justify-end gap-1 text-xs text-mute">
                    <input type="number" step="0.5" aria-label={`${t.name} change %`} value={changes[t.key] ?? 0}
                      onChange={(e) => setChanges((ch) => ({ ...ch, [t.key]: Number(e.target.value) }))}
                      className="w-16 rounded border border-line px-1.5 py-0.5 text-right text-ink outline-none focus:border-brand" />%
                  </label>
                </div>
              );
            })}
          </div>
        );
      })}
      <p className="mt-3 text-[11px] text-mute">Change span to goal: {pct(span)} points.</p>
      <Notes findings={[]} comment={comments("goalseek")} />
    </>
  );
}

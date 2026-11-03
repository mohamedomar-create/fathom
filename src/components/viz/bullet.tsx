"use client";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/use-t";
import { bulletScale } from "@/lib/viz/geometry";
import { TONE } from "./palette";

/**
 * Actual against target on one track: the bar is the actual, the tick is the target; an icon and a word say on or off
 * target (never colour alone). `lowerIsBetter`: days to collect, cost ratios.
 */
export function Bullet({ label, value, target, fmt, lowerIsBetter, sub, testId }: {
  label: string; value: number | null; target: number | null | undefined; fmt: (v: number) => string; lowerIsBetter?: boolean; sub?: React.ReactNode; testId?: string;
}) {
  const { d } = useT();
  if (value === null || !Number.isFinite(value)) {
    return <div className="py-2" data-testid={testId}><div className="flex justify-between text-[13px]"><span>{label}</span><span className="text-mute">–</span></div></div>;
  }
  const b = bulletScale(value, target);
  const ok = target === null || target === undefined ? null : lowerIsBetter ? value <= target : value >= target;
  const color = ok === null ? "#0b6e70" : ok ? TONE.good : TONE.bad;
  return (
    <div className="py-2" data-testid={testId} data-ok={ok === null ? "none" : ok ? "yes" : "no"}>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
        <span className="min-w-0 truncate">{label}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          <b className="num font-semibold">{fmt(value)}</b>
          {ok !== null && (ok
            ? <CheckCircle2 className="h-3.5 w-3.5 text-green-d" aria-label={d.viz.onTarget} />
            : <AlertTriangle className="h-3.5 w-3.5 text-red" aria-label={d.viz.offTarget} />)}
        </span>
      </div>
      <div dir="ltr" className="relative h-2.5 rounded-full bg-band" aria-hidden>
        <div className={cn("absolute inset-y-0 start-0 rounded-full")} style={{ width: `${b.valuePct}%`, background: color, left: 0 }} />
        {b.targetPct !== null && <div className="absolute -inset-y-1 w-[3px] rounded bg-ink" style={{ left: `calc(${b.targetPct}% - 1.5px)` }} />}
      </div>
      {(target !== null && target !== undefined) || sub ? (
        <div className="mt-0.5 flex justify-between gap-2 text-[11.5px] text-mute">
          <span>{sub}</span>
          {target !== null && target !== undefined && <span>{d.viz.target}: <span className="num">{fmt(target)}</span></span>}
        </div>
      ) : null}
    </div>
  );
}

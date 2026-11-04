"use client";
import { SEQ } from "./palette";

/**
 * What moves a figure most: each driver moved down and up, drawn as two bars either side of the base value (lower dark,
 * higher light: one blue), largest spread first. Labels and values follow the page direction; the track stays left to right.
 */
export function Tornado({ rows, base, fmt, lowLabel, highLabel, testId }: {
  rows: { label: string; low: number; high: number }[]; base: number; fmt: (v: number) => string; lowLabel: string; highLabel: string; testId?: string;
}) {
  if (!rows.length) return <p className="text-sm text-mute" data-testid={testId}>–</p>;
  const lo = Math.min(base, ...rows.flatMap((r) => [r.low, r.high])), hi = Math.max(base, ...rows.flatMap((r) => [r.low, r.high]));
  const span = hi - lo || 1;
  const at = (v: number) => ((v - lo) / span) * 100;
  const DOWN = SEQ[5], UP = SEQ[2];
  return (
    <div data-testid={testId}>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-mute">
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: DOWN }} aria-hidden />{lowLabel}</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm" style={{ background: UP }} aria-hidden />{highLabel}</span>
      </div>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.label} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-3 text-[13px] sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
            <span className="truncate">{r.label}</span>
            <div>
              <div dir="ltr" className="relative h-4 rounded bg-band" role="img" aria-label={`${r.label}: ${lowLabel} ${fmt(r.low)}, ${highLabel} ${fmt(r.high)}`}>
                {[{ v: r.low, c: DOWN }, { v: r.high, c: UP }].map(({ v, c }, i) => (
                  <span key={i} className="absolute inset-y-0 rounded-sm" style={{ left: `${Math.min(at(v), at(base))}%`, width: `${Math.max(0.5, Math.abs(at(v) - at(base)))}%`, background: c }} />
                ))}
                <span className="absolute -inset-y-1 w-[2px] bg-ink" style={{ left: `calc(${at(base)}% - 1px)` }} />
              </div>
              <div className="mt-0.5 flex justify-between text-[11px] text-mute num"><span>{fmt(Math.min(r.low, r.high))}</span><span>{fmt(Math.max(r.low, r.high))}</span></div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

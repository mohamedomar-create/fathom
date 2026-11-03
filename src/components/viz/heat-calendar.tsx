"use client";
import { monthNames } from "@/lib/i18n";
import { useT } from "@/lib/i18n/use-t";
import { heatGrid, heatLevel } from "@/lib/viz/geometry";
import { SEQ, seqInk } from "./palette";

const NEG = ["#fde7e5", "#f7b9b3", "#ec8178", "#d9343a"] as const;

/**
 * Seasonality at a glance: one row per year, one cell per calendar month, darker = more. Values below zero (a loss month)
 * take a red scale of their own. Each cell carries its figure as text on hover and for screen readers.
 */
export function HeatCalendar({ periods, values, fmt, testId, label }: { periods: string[]; values: (number | null)[]; fmt: (v: number) => string; testId?: string; label?: string }) {
  const T = useT();
  const g = heatGrid(periods, values);
  if (!g.years.length) return <p className="text-sm text-mute">{T.d.viz.noData}</p>;
  const names = monthNames(T.lang);
  const pos = Math.max(0, g.hi), neg = Math.min(0, g.lo);
  const cell = (v: number | null) => {
    if (v === null) return { bg: "#f5f5f3", fg: "#a9a9a3" };
    if (v < 0) { const i = heatLevel(-v, 0, -neg || 1, NEG.length); return { bg: NEG[i], fg: i >= 3 ? "#fff" : "#0b0b0b" }; }
    const i = heatLevel(v, Math.max(0, g.lo), pos || 1, SEQ.length);
    return { bg: SEQ[i], fg: seqInk(i) };
  };
  return (
    <div dir="ltr" tabIndex={0} role="region" aria-label={label ?? T.d.viz.fin.seasonality} className="overflow-x-auto" data-testid={testId}>
      <table className="w-full border-separate border-spacing-[3px] text-[10.5px]">
        <thead>
          <tr><th className="w-10" />{names.slice(1, 13).map((m) => <th key={m} className="px-0.5 pb-1 text-center font-normal text-mute">{T.lang === "ar" ? m : m.slice(0, 3)}</th>)}</tr>
        </thead>
        <tbody>
          {g.years.map((y, r) => (
            <tr key={y}>
              <th className="pe-1 text-end font-medium text-mute">{y}</th>
              {g.cells[r].map((v, c) => {
                const s = cell(v);
                const label = `${names[c + 1]} ${y}: ${v === null ? T.d.viz.noData : fmt(v)}`;
                return (
                  <td key={c} title={label} aria-label={label} className="h-8 min-w-9 rounded-md text-center font-medium tabular-nums" style={{ background: s.bg, color: s.fg }}>
                    {v === null ? "" : fmt(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[11px] text-mute" aria-hidden>
        <span>{T.d.viz.low}</span>{SEQ.map((c) => <i key={c} className="inline-block h-2.5 w-4 rounded-sm" style={{ background: c }} />)}<span>{T.d.viz.high}</span>
      </div>
    </div>
  );
}

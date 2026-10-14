"use client";
import { useState } from "react";

export interface RadarAxis { label: string; completion: number; accuracy: number | null }

// Validated pair (dataviz palette check, light surface): teal for completion, orange for accuracy.
const COMPLETE = "#009b95", ACCURATE = "#eb6834";

/**
 * Two shapes over the same axes (0–100%): how complete the data is, and how accurate what is loaded is.
 * An axis with nothing to check draws its accuracy at its completion. Hover an axis for both values.
 */
export function RadarChart({ axes, size = 260, testId, compact = false }: { axes: RadarAxis[]; size?: number; testId?: string; compact?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = Math.max(3, axes.length);
  // Labels sit outside the shape: extra width on both sides keeps long ones ("Balance sheets") whole.
  const pad = compact ? 14 : 30, side = compact ? 0 : 70;
  const W = size + side * 2, H = size + (compact ? 0 : 16);
  const R = size / 2 - pad, cx = W / 2, cy = H / 2;
  const ang = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const pt = (i: number, v: number) => [cx + Math.cos(ang(i)) * R * (v / 100), cy + Math.sin(ang(i)) * R * (v / 100)] as const;
  const poly = (vals: number[]) => vals.map((v, i) => pt(i, v).map((x) => x.toFixed(1)).join(",")).join(" ");
  const comp = axes.map((a) => a.completion), acc = axes.map((a) => a.accuracy ?? a.completion);
  return (
    <div dir="ltr" className="relative inline-block" data-testid={testId}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="max-w-full" role="img" aria-label={`Data completion and accuracy: ${axes.map((a) => `${a.label} ${a.completion}% complete${a.accuracy !== null ? `, ${a.accuracy}% accurate` : ""}`).join("; ")}`}>
        {[25, 50, 75, 100].map((r) => <polygon key={r} points={poly(axes.map(() => r))} fill="none" stroke="#e6e6e1" strokeWidth={1} />)}
        {axes.map((_, i) => { const [x, y] = pt(i, 100); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#e6e6e1" />; })}
        <polygon points={poly(comp)} fill={COMPLETE} fillOpacity={0.16} stroke={COMPLETE} strokeWidth={2} strokeLinejoin="round" />
        <polygon points={poly(acc)} fill="none" stroke={ACCURATE} strokeWidth={2} strokeDasharray="5 3" strokeLinejoin="round" />
        {axes.map((a, i) => {
          const [x, y] = pt(i, a.completion);
          const [x2, y2] = pt(i, a.accuracy ?? a.completion);
          return <g key={i}><circle cx={x} cy={y} r={hover === i ? 5 : 3} fill={COMPLETE} stroke="#fff" /><circle cx={x2} cy={y2} r={hover === i ? 4 : 2.5} fill={ACCURATE} stroke="#fff" /></g>;
        })}
        {!compact && axes.map((a, i) => {
          const [x, y] = pt(i, 112);
          const anchor = Math.abs(x - cx) < 6 ? "middle" : x > cx ? "start" : "end";
          return (
            <text key={i} x={x} y={y + 4} textAnchor={anchor} fontSize={11} fill={hover === i ? "#222" : "#76766f"} fontWeight={hover === i ? 600 : 400}>{a.label}</text>
          );
        })}
        {/* Hit areas: one wedge per axis. */}
        {axes.map((_, i) => {
          const a0 = ang(i) - Math.PI / n, a1 = ang(i) + Math.PI / n;
          const d = `M${cx},${cy} L${cx + Math.cos(a0) * (R + pad)},${cy + Math.sin(a0) * (R + pad)} L${cx + Math.cos(a1) * (R + pad)},${cy + Math.sin(a1) * (R + pad)} Z`;
          return <path key={`h${i}`} d={d} fill="transparent" onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} />;
        })}
      </svg>
      {hover !== null && axes[hover] && (
        <div role="tooltip" className="pointer-events-none absolute left-1/2 top-1/2 z-10 min-w-40 -translate-x-1/2 -translate-y-1/2 rounded-md border border-line bg-white/95 px-3 py-2 text-xs shadow-lg">
          <div className="mb-1 font-semibold">{axes[hover].label}</div>
          <div className="flex justify-between gap-4"><span className="flex items-center gap-1.5 text-mute"><i className="inline-block h-2 w-2 rounded-full" style={{ background: COMPLETE }} />Complete</span><b className="num">{axes[hover].completion}%</b></div>
          <div className="flex justify-between gap-4"><span className="flex items-center gap-1.5 text-mute"><i className="inline-block h-2 w-2 rounded-full" style={{ background: ACCURATE }} />Accurate</span><b className="num">{axes[hover].accuracy === null ? "–" : `${axes[hover].accuracy}%`}</b></div>
        </div>
      )}
    </div>
  );
}

export function RadarLegend() {
  return (
    <div className="flex flex-wrap gap-4 text-xs">
      <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COMPLETE }} />Data complete</span>
      <span className="flex items-center gap-1.5"><i className="inline-block h-0.5 w-4 border-t-2 border-dashed" style={{ borderColor: ACCURATE }} />Data accurate</span>
    </div>
  );
}

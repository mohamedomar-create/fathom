"use client";
import { motion } from "motion/react";
import { useRef, useState } from "react";
import { money } from "@/lib/engine";
import { ChartTip } from "./tooltip";
import { useStaticCharts } from "./static";
import { niceTicks } from "./util";

const G = "#7CB46B", R = "#D9343A", K = "#333";

export function BreakevenChart({ revenue, fixed, vcr, bep, cur }: { revenue: number; fixed: number; vcr: number; bep: number; cur: string }) {
  const st = useStaticCharts();
  const w = 560, h = 440, pl = 70, pr = 14, pt = 12, pb = 34;
  const xmax = Math.max(revenue, bep) * 1.45;
  const ymax = Math.max(xmax, fixed + vcr * xmax) * 1.05;
  const X = (v: number) => pl + ((w - pl - pr) * v) / xmax;
  const Y = (v: number) => pt + (h - pt - pb) * (1 - v / ymax);
  const ref = useRef<SVGSVGElement>(null);
  const [hx, setHx] = useState<number | null>(null);
  const onMove = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * w;
    const v = ((x - pl) / (w - pl - pr)) * xmax;
    setHx(v >= 0 && v <= xmax ? v : null);
  };
  const [lo, hi] = [Math.min(bep, revenue), Math.max(bep, revenue)];
  const wedge = `${X(lo)},${Y(lo)} ${X(hi)},${Y(hi)} ${X(hi)},${Y(fixed + vcr * hi)} ${X(lo)},${Y(fixed + vcr * lo)}`;
  const line = (x0: number, y0: number, x1: number, y1: number, col: string, delay: number) => (
    <motion.line initial={st ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8, delay }} x1={X(x0)} y1={Y(y0)} x2={X(x1)} y2={Y(y1)} stroke={col} strokeWidth={2.4} strokeLinecap="round" />
  );
  const pill = (x: number, y: number, txt: string, col: string) => (
    <g>
      <rect x={x - txt.length * 3.9 - 10} y={y - 11} rx={11} width={txt.length * 7.8 + 20} height={22} fill={col} />
      <text x={x} y={y + 4} textAnchor="middle" fill="#fff" fontSize={11} letterSpacing=".5">{txt}</text>
    </g>
  );
  return (
    <div className="relative">
      <svg ref={ref} viewBox={`0 0 ${w} ${h}`} className="w-full touch-pan-y" onPointerMove={onMove} onPointerLeave={() => setHx(null)} role="img" aria-label="Breakeven chart">
        {niceTicks(0, ymax, 6).filter((t) => t <= ymax).map((t) => (
          <g key={t}><line x1={pl} x2={w - pr} y1={Y(t)} y2={Y(t)} className="grid-line" /><text x={pl - 6} y={Y(t) + 4} className="ax" textAnchor="end">{money(t, cur, true)}</text></g>
        ))}
        {niceTicks(0, xmax, 5).filter((t) => t > 0 && t <= xmax).map((t) => (
          <text key={t} x={X(t)} y={h - 12} className="ax" textAnchor="middle">{money(t, cur, true)}</text>
        ))}
        <rect x={pl} y={Y(fixed)} width={w - pl - pr} height={Y(0) - Y(fixed)} fill="#000" opacity={0.035} />
        <motion.polygon initial={st ? false : { opacity: 0 }} animate={{ opacity: 0.2 }} transition={{ delay: 0.9 }} points={wedge} fill={revenue >= bep ? G : R} />
        {line(0, fixed, xmax, fixed, K, 0)}
        {line(0, fixed, xmax, fixed + vcr * xmax, R, 0.15)}
        {line(0, 0, xmax, xmax, G, 0.3)}
        <circle cx={X(bep)} cy={Y(bep)} r={7} fill="#fff" stroke={K} strokeWidth={3} />
        <circle cx={X(revenue)} cy={Y(revenue)} r={7} fill="#fff" stroke={G} strokeWidth={3} />
        <circle cx={X(revenue)} cy={Y(fixed + vcr * revenue)} r={7} fill="#fff" stroke={R} strokeWidth={3} />
        {pill(X(xmax * 0.86) - 20, Y(xmax * 0.86) - 26, "REVENUE", G)}
        {pill(X(xmax * 0.86), Y(fixed + vcr * xmax * 0.86) + 30, "VARIABLE COSTS", R)}
        {pill(X(xmax * 0.16) + 30, Y(fixed) + 26, "FIXED COSTS", K)}
        {hx !== null && (
          <g pointerEvents="none">
            <line x1={X(hx)} x2={X(hx)} y1={pt} y2={h - pb} stroke="#bbb" strokeDasharray="3 3" />
            <circle cx={X(hx)} cy={Y(hx)} r={4.5} fill={G} />
            <circle cx={X(hx)} cy={Y(fixed + vcr * hx)} r={4.5} fill={R} />
          </g>
        )}
        <text x={pl} y={pt + 2} className="axt" dy="0.7em">{""}</text>
      </svg>
      <ChartTip show={hx !== null} x={hx !== null ? (X(hx) / w) * 100 : 0} y={30}>
        {hx !== null && (() => {
          const cost = fixed + vcr * hx, pr_ = hx - cost;
          return (
            <>
              <div className="mb-1 font-semibold">At revenue of {money(hx, cur)}</div>
              <div className="flex justify-between gap-4"><span className="text-mute">Total costs</span><span className="num">{money(cost, cur)}</span></div>
              <div className="flex justify-between gap-4"><span className="text-mute">{pr_ >= 0 ? "Profit" : "Loss"}</span><span className={`num font-semibold ${pr_ >= 0 ? "text-green-d" : "text-red"}`}>{money(pr_, cur)}</span></div>
            </>
          );
        })()}
      </ChartTip>
    </div>
  );
}

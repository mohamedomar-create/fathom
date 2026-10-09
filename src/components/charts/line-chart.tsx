"use client";
import { motion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import type { Unit } from "@/lib/engine";
import { ChartTip } from "./tooltip";
import { useStaticCharts } from "./static";
import { axisLabel, niceTicks, valueLabel } from "./util";

export interface Series { name: string; values: (number | null)[]; color: string; fill?: boolean; dashed?: boolean }

export function LineChart({
  labels, series, unit = "cur", cur = "$", target, marks, height = 300, testId,
}: {
  labels: string[]; series: Series[]; unit?: Unit; cur?: string; target?: number | null; marks?: (boolean | null)[]; height?: number; testId?: string;
}) {
  const st = useStaticCharts();
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(900);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const h = height;
  const pl = w < 500 ? 46 : 70, pr = 16, pt = 15, pb = marks ? 46 : 34;
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const clip = useId();
  const vals = series.flatMap((s) => s.values.filter((v): v is number => v !== null && Number.isFinite(v)));
  if (target !== null && target !== undefined) vals.push(target);
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const n = labels.length;
  const X = (i: number) => pl + (w - pl - pr) * (n > 1 ? i / (n - 1) : 0.5);
  const Y = (v: number) => pt + (h - pt - pb) * (1 - (v - lo) / (hi - lo || 1));
  const step = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(w / 75))));
  const onMove = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * w;
    const i = Math.round(((x - pl) / (w - pl - pr)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  return (
    <div ref={box} className="relative" data-testid={testId}>
      {series.length > 1 && (
        <div className="mb-1 flex flex-wrap gap-4 text-xs">
          {series.map((s) => <span key={s.name} className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />{s.name}</span>)}
        </div>
      )}
      <svg ref={ref} viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="block max-w-full touch-pan-y" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img"
        aria-label={series.map((s) => s.name).join(", ") + " chart"}>
        <defs><clipPath id={clip}><rect x={pl} y={0} width={w - pl - pr} height={h} /></clipPath></defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pl} x2={w - pr} y1={Y(t)} y2={Y(t)} className="grid-line" />
            <text x={pl - 8} y={Y(t) + 4} className="ax" textAnchor="end">{w < 500 && unit === "cur" ? axisLabel(t, unit, cur).replace(`${cur} `, "") : axisLabel(t, unit, cur)}</text>
          </g>
        ))}
        {lo < 0 && <line x1={pl} x2={w - pr} y1={Y(0)} y2={Y(0)} stroke="#cfcfca" />}
        {labels.map((l, i) => ((i % step === 0 && (n - 1 - i >= step * 0.6 || i === n - 1)) || i === n - 1) && (
          <text key={i} x={X(i)} y={h - 10} className="ax" textAnchor="middle">{l}</text>
        ))}
        {target !== null && target !== undefined && (
          <g>
            <line x1={pl} x2={w - pr} y1={Y(target)} y2={Y(target)} stroke="#B98BCB" strokeDasharray="5 4" strokeWidth={1.5} />
            <text x={w - pr} y={Y(target) - 5} textAnchor="end" className="ax" fill="#9a6bb0">Target {axisLabel(target, unit, cur)}</text>
          </g>
        )}
        <g clipPath={`url(#${clip})`}>
          {series.map((s) => {
            const pts = s.values.map((v, i) => (v === null || !Number.isFinite(v) ? null : ([X(i), Y(v)] as const))).filter(Boolean) as (readonly [number, number])[];
            if (!pts.length) return null;
            const d = "M" + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L");
            const base = Y(Math.max(lo, 0));
            return (
              <g key={s.name}>
                {s.fill && <motion.path initial={st ? false : { opacity: 0 }} animate={{ opacity: 0.14 }} transition={{ duration: 0.8 }} d={`${d} L${pts[pts.length - 1][0]},${base} L${pts[0][0]},${base} Z`} fill={s.color} />}
                <motion.path initial={st ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: "easeOut" }}
                  d={d} fill="none" stroke={s.color} strokeWidth={2.2} strokeLinejoin="round" strokeDasharray={s.dashed ? "6 4" : undefined} />
                {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={3.2} fill={s.color} stroke="#fff" strokeWidth={1} />)}
              </g>
            );
          })}
        </g>
        {marks?.map((ok, i) => ok === null ? null : (
          <text key={i} x={X(i)} y={h - 26} textAnchor="middle" fontSize={11} fill={ok ? "#4F8A41" : "#D9343A"}>{ok ? "✓" : "✕"}</text>
        ))}
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={X(hover)} x2={X(hover)} y1={pt} y2={h - pb} stroke="#bbb" strokeDasharray="3 3" />
            {series.map((s) => s.values[hover] !== null && s.values[hover] !== undefined && (
              <circle key={s.name} cx={X(hover)} cy={Y(s.values[hover]!)} r={5.5} fill="#fff" stroke={s.color} strokeWidth={2.5} />
            ))}
          </g>
        )}
        <rect x={pl} y={pt} width={w - pl - pr} height={h - pt - pb} fill="transparent" />
      </svg>
      <ChartTip show={hover !== null} x={hover !== null ? (X(hover) / w) * 100 : 0} y={35}>
        {hover !== null && (
          <>
            <div className="mb-1 font-semibold">{labels[hover]}</div>
            {series.map((s) => (
              <div key={s.name} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5 text-mute"><i className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />{s.name}</span>
                <span className="num font-medium">{valueLabel(s.values[hover], unit, cur)}</span>
              </div>
            ))}
            {target !== null && target !== undefined && <div className="mt-1 text-mute">Target {valueLabel(target, unit, cur)}</div>}
          </>
        )}
      </ChartTip>
    </div>
  );
}

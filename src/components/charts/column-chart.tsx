"use client";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { Unit } from "@/lib/engine";
import { ChartTip } from "./tooltip";
import { useStaticCharts } from "./static";
import { axisLabel, niceTicks, valueLabel } from "./util";

export interface ColumnSeries { name: string; values: (number | null)[]; color: string }

/** Grouped columns per period on one zero-based axis (values may be negative), with a per-period tooltip. */
export function ColumnChart({ labels, series, unit = "cur", cur = "$", height = 280, testId }: { labels: string[]; series: ColumnSeries[]; unit?: Unit; cur?: string; height?: number; testId?: string }) {
  const st = useStaticCharts();
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(900);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const h = height, pl = w < 500 ? 46 : 70, pr = 12, pt = 12, pb = 30;
  const vals = series.flatMap((s) => s.values.filter((v): v is number => v !== null && Number.isFinite(v)));
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const n = labels.length;
  const slot = (w - pl - pr) / Math.max(1, n);
  const groupW = Math.min(slot * 0.72, 22 * series.length + 2 * (series.length - 1));
  const barW = Math.max(2, (groupW - 2 * (series.length - 1)) / series.length);
  const Y = (v: number) => pt + (h - pt - pb) * (1 - (v - lo) / (hi - lo || 1));
  const x0 = (i: number) => pl + slot * i + (slot - groupW) / 2;
  const step = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(w / 70))));
  return (
    <div ref={box} className="relative" data-testid={testId}>
      <div className="mb-1 flex flex-wrap gap-4 text-xs">
        {series.map((s) => <span key={s.name} className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.name}</span>)}
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="block max-w-full touch-pan-y" role="img" aria-label={`${series.map((s) => s.name).join(", ")} by month`}
        onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pl} x2={w - pr} y1={Y(t)} y2={Y(t)} className="grid-line" />
            <text x={pl - 8} y={Y(t) + 4} className="ax" textAnchor="end">{w < 500 && unit === "cur" ? axisLabel(t, unit, cur).replace(`${cur} `, "") : axisLabel(t, unit, cur)}</text>
          </g>
        ))}
        <line x1={pl} x2={w - pr} y1={Y(0)} y2={Y(0)} stroke="#a9a9a3" />
        {labels.map((l, i) => i % step === 0 && <text key={i} x={pl + slot * (i + 0.5)} y={h - 10} className="ax" textAnchor="middle">{l}</text>)}
        {hover !== null && <rect x={pl + slot * hover} y={pt} width={slot} height={h - pt - pb} fill="#000" opacity={0.04} />}
        {series.map((s, k) => s.values.map((v, i) => {
          if (v === null || !Number.isFinite(v) || v === 0) return null;
          const y = Y(Math.max(v, 0)), hh = Math.abs(Y(v) - Y(0));
          return (
            <motion.rect key={`${k}-${i}`} x={x0(i) + k * (barW + 2)} width={barW} rx={2} fill={s.color}
              initial={st ? false : { y: Y(0), height: 0 }} animate={{ y, height: Math.max(1, hh) }} transition={{ duration: 0.6, ease: "easeOut" }} />
          );
        }))}
        {/* Hit areas wider than the bars: one per period. */}
        {labels.map((_, i) => <rect key={i} x={pl + slot * i} y={pt} width={slot} height={h - pt - pb} fill="transparent" onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} />)}
      </svg>
      <ChartTip show={hover !== null} x={hover !== null ? ((pl + slot * (hover + 0.5)) / w) * 100 : 0} y={40}>
        {hover !== null && (
          <>
            <div className="mb-1 font-semibold">{labels[hover]}</div>
            {series.map((s) => (
              <div key={s.name} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5 text-mute"><i className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />{s.name}</span>
                <span className="num font-medium">{valueLabel(s.values[hover], unit, cur)}</span>
              </div>
            ))}
          </>
        )}
      </ChartTip>
    </div>
  );
}

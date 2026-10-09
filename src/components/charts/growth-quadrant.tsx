"use client";
import { motion } from "motion/react";
import { useState } from "react";
import { money, quadrantOf, type Quadrant } from "@/lib/engine";
import { ChartTip } from "./tooltip";
import { niceTicks } from "./util";

export interface GrowthPoint { label: string; x: number; y: number }

export function GrowthQuadrant({ points, cur }: { points: GrowthPoint[]; cur: string }) {
  const w = 760, h = 470, pl = 84, pr = 20, pt = 20, pb = 52;
  const [hover, setHover] = useState<number | null>(null);
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const { x: x0, y: y0 } = points[0];
  const xr = Math.max(...xs) - Math.min(...xs) || Math.abs(x0) || 1;
  const yr = Math.max(...ys) - Math.min(...ys) || Math.abs(y0) || 1;
  const xlo = Math.min(...xs) - xr * 0.25, xhi = Math.max(...xs) + xr * 0.25;
  const ylo = Math.min(...ys) - yr * 0.25, yhi = Math.max(...ys) + yr * 0.25;
  const X = (v: number) => pl + ((w - pl - pr) * (v - xlo)) / (xhi - xlo);
  const Y = (v: number) => pt + (h - pt - pb) * (1 - (v - ylo) / (yhi - ylo));
  const d = "M" + points.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" L");
  const q: [Quadrant, number, number, "start" | "end"][] = [
    ["EFFICIENCY GAINS", pl + 12, pt + 22, "start"], ["QUALITY GROWTH", w - pr - 12, pt + 22, "end"],
    ["DECLINE", pl + 12, h - pb - 12, "start"], ["STRESS", w - pr - 12, h - pb - 12, "end"],
  ];
  const last = points[points.length - 1];
  const now = quadrantOf(last.x, last.y, x0, y0);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Growth quadrant">
        <rect x={pl} y={pt} width={w - pl - pr} height={h - pt - pb} fill="#FAFAF9" stroke="#EEE" />
        <line x1={X(x0)} x2={X(x0)} y1={pt} y2={h - pb} stroke="#CCC" />
        <line y1={Y(y0)} y2={Y(y0)} x1={pl} x2={w - pr} stroke="#CCC" />
        {q.map(([t, x, y, anchor]) => (
          <text key={t} x={x} y={y} textAnchor={anchor} fontSize={12} letterSpacing=".08em" fill={t === now ? (t === "STRESS" || t === "DECLINE" ? "#D9343A" : "#4F8A41") : "#a5a5a0"} fontWeight={t === now ? 600 : 400}>{t}</text>
        ))}
        <motion.path initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.4, ease: "easeInOut" }} d={d} fill="none" stroke="#999" strokeWidth={10} opacity={0.2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <motion.circle key={i} initial={{ r: 0 }} animate={{ r: i === points.length - 1 ? 10 : hover === i ? 8 : 5.5 }} transition={{ delay: 0.1 * i }}
            cx={X(p.x)} cy={Y(p.y)} fill={i === points.length - 1 ? "#5E9A4F" : "#7CB46B"} stroke="#fff" strokeWidth={2}
            onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} style={{ cursor: "pointer" }} />
        ))}
        {points.map((p, i) => <circle key={`hit${i}`} cx={X(p.x)} cy={Y(p.y)} r={14} fill="transparent" onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} />)}
        <text x={X(last.x)} y={Y(last.y) - 16} textAnchor="middle" className="ax" fontWeight={600}>{last.label}</text>
        <text x={(pl + w - pr) / 2} y={h - 10} textAnchor="middle" className="axt">TOTAL OPERATING INVESTMENT</text>
        <text transform={`translate(18,${(pt + h - pb) / 2}) rotate(-90)`} textAnchor="middle" className="axt">EARNINGS BEFORE INTEREST &amp; TAX</text>
        {niceTicks(xlo, xhi, 4).filter((t) => t >= xlo && t <= xhi).map((t) => <text key={t} x={X(t)} y={h - pb + 17} textAnchor="middle" className="ax">{money(t, cur, true)}</text>)}
        {niceTicks(ylo, yhi, 4).filter((t) => t >= ylo && t <= yhi).map((t) => <text key={t} x={pl - 6} y={Y(t) + 4} textAnchor="end" className="ax">{money(t, cur, true)}</text>)}
      </svg>
      <ChartTip show={hover !== null} x={hover !== null ? (X(points[hover].x) / w) * 100 : 0} y={hover !== null ? (Y(points[hover].y) / h) * 100 : 0}>
        {hover !== null && (
          <>
            <div className="mb-1 font-semibold">{points[hover].label}</div>
            <div className="flex justify-between gap-4"><span className="text-mute">EBIT</span><span className="num">{money(points[hover].y, cur)}</span></div>
            <div className="flex justify-between gap-4"><span className="text-mute">Operating investment</span><span className="num">{money(points[hover].x, cur)}</span></div>
            {hover > 0 && <div className="mt-1 text-[11px] tracking-wide text-mute">{quadrantOf(points[hover].x, points[hover].y, x0, y0)}</div>}
          </>
        )}
      </ChartTip>
    </div>
  );
}

export function QuadrantMiniMap({ active }: { active: Quadrant }) {
  const cells: Quadrant[] = ["EFFICIENCY GAINS", "QUALITY GROWTH", "DECLINE", "STRESS"];
  return (
    <div className="grid w-40 grid-cols-2 gap-1 text-[9px] tracking-wider">
      {cells.map((c) => {
        const on = c === active;
        const bad = c === "STRESS" || c === "DECLINE";
        return (
          <div key={c} className={`flex h-14 items-center justify-center rounded px-1 text-center ${on ? (bad ? "bg-red text-white" : "bg-green text-white") : "bg-band text-mute"}`}>{c}</div>
        );
      })}
    </div>
  );
}

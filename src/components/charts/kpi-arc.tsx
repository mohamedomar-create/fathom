"use client";
import { motion } from "motion/react";
import { useState } from "react";
import { CAT_COL, type KpiCategory } from "@/lib/engine";
import { ChartTip } from "./tooltip";
import { useStaticCharts } from "./static";

export interface ArcItem { key: string; category: KpiCategory; name: string; ok: boolean; detail: string }

/** Semicircular KPI Explorer: one rotated tile per KPI with a result, grouped by category. */
export function KpiArc({ items, pctOn, period, onSelect }: { items: ArcItem[]; pctOn: number; period: string; onSelect?: (key: string) => void }) {
  const st = useStaticCharts();
  const w = 1000, h = 560, cx = w / 2, cy = h - 50, R = 280;
  const [hover, setHover] = useState<number | null>(null);
  const n = items.length;
  const ang = (i: number) => Math.PI - ((i + 0.5) * Math.PI) / Math.max(n, 1);
  const groups: { cat: string; from: number; to: number }[] = [];
  items.forEach((it, i) => {
    const g = groups[groups.length - 1];
    if (g && g.cat === it.category) g.to = i; else groups.push({ cat: it.category, from: i, to: i });
  });
  const pos = (i: number, r: number) => [cx + r * Math.cos(ang(i)), cy - r * Math.sin(ang(i))] as const;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="KPI Explorer arc">
        <path d={`M${cx - R - 34},${cy} A${R + 34},${R + 34} 0 0 1 ${cx + R + 34},${cy}`} fill="none" stroke="#F1F1EF" strokeWidth={44} />
        {groups.map((g) => {
          const a0 = ang(g.from) + Math.PI / Math.max(n, 1) / 2 - 0.01, a1 = ang(g.to) - Math.PI / Math.max(n, 1) / 2 + 0.01;
          const r = R - 46;
          const am = (a0 + a1) / 2;
          const [lx, ly] = [cx + (r - 22) * Math.cos(am), cy - (r - 22) * Math.sin(am)];
          return (
            <g key={g.cat}>
              <path d={`M${cx + r * Math.cos(a0)},${cy - r * Math.sin(a0)} A${r},${r} 0 0 1 ${cx + r * Math.cos(a1)},${cy - r * Math.sin(a1)}`} fill="none" stroke={CAT_COL[g.cat as KpiCategory]} strokeWidth={4} strokeLinecap="round" opacity={0.75} />
              {g.to - g.from >= 2 && <text x={lx} y={ly} textAnchor="middle" fontSize={10} letterSpacing=".06em" fill="#999" transform={`rotate(${90 - (am * 180) / Math.PI},${lx},${ly})`}>{g.cat.toUpperCase()}</text>}
            </g>
          );
        })}
        {items.map((it, i) => {
          const [x, y] = pos(i, R);
          const rot = -(ang(i) * 180) / Math.PI + 90;
          const deg = (ang(i) * 180) / Math.PI;
          const [lx, ly] = pos(i, R + 26);
          const tr = deg <= 90 ? -deg : 180 - deg;
          const nm = it.name.length <= 28 ? it.name : it.name.slice(0, 27) + "…";
          return (
            <g key={it.key} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onClick={() => onSelect?.(it.key)} style={{ cursor: onSelect ? "pointer" : "default" }}>
              <motion.g initial={st ? false : { opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: hover === i ? 1.18 : 1 }} transition={{ delay: 0.03 * i, duration: 0.3 }} style={{ originX: `${x}px`, originY: `${y}px` }}>
                <g transform={`translate(${x},${y}) rotate(${rot})`}>
                  <rect x={-14} y={-14} width={28} height={28} rx={2} fill={it.ok ? "#2E9E6A" : "#D9343A"} />
                  <text y={5} textAnchor="middle" fill="#fff" fontSize={15} fontWeight={700}>{it.ok ? "○" : "✕"}</text>
                </g>
              </motion.g>
              <text transform={`translate(${lx},${ly}) rotate(${tr})`} dy={4} fontSize={11} textAnchor={deg <= 90 ? "start" : "end"} fill={hover === i ? "#222" : "#555"}>{nm}</text>
            </g>
          );
        })}
        <text x={cx} y={cy - 56} textAnchor="middle" fontSize={56} fontWeight={300}>{Math.round(pctOn)}%</text>
        <text x={cx} y={cy - 20} textAnchor="middle" fontSize={20} fontWeight={600}>{period}</text>
        <text x={cx} y={cy + 4} textAnchor="middle" className="ax">on track</text>
      </svg>
      <div className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-mute">
        {groups.map((g) => <span key={g.cat} className="flex items-center gap-1.5"><i className="inline-block h-1 w-4 rounded" style={{ background: CAT_COL[g.cat as KpiCategory] }} />{g.cat}</span>)}
      </div>
      <ChartTip show={hover !== null} x={hover !== null ? (pos(hover, R)[0] / w) * 100 : 0} y={hover !== null ? (pos(hover, R)[1] / h) * 100 : 0}>
        {hover !== null && (<><div className="font-semibold">{items[hover].name}</div><div className="text-mute">{items[hover].detail}</div></>)}
      </ChartTip>
    </div>
  );
}

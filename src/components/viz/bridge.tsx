"use client";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { compact, money } from "@/lib/engine/format";
import { useT } from "@/lib/i18n/use-t";
import { ChartTip } from "@/components/charts/tooltip";
import { useStaticCharts } from "@/components/charts/static";
import { niceTicks } from "@/components/charts/util";
import { bridgeSteps, type BridgeInput } from "@/lib/viz/geometry";
import { INK, TONE } from "./palette";

const TOTAL = "#0b6e70";

/**
 * A vertical bridge: start total, the steps up (green) and down (red) with connectors, end total. Each column has its value
 * on top (compact) and the exact amount in the tooltip.
 */
export function Bridge({ rows, cur, height = 300, testId }: { rows: BridgeInput[]; cur: string; height?: number; testId?: string }) {
  const T = useT();
  const st = useStaticCharts();
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(720);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const steps = bridgeSteps(rows);
  const lang = T.lang === "ar" ? "ar" : "en";
  const vals = steps.flatMap((s) => [s.from, s.to]).concat(0);
  const ticks = niceTicks(Math.min(...vals), Math.max(...vals), 5);
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const narrow = w < 520;
  const h = height, pl = narrow ? 40 : 56, pr = 8, pt = 22, pb = 50;
  const n = steps.length;
  const slot = (w - pl - pr) / Math.max(1, n);
  const bw = Math.min(56, slot * 0.64);
  const Y = (v: number) => pt + (h - pt - pb) * (1 - (v - lo) / (hi - lo || 1));
  const cx = (i: number) => pl + slot * (i + 0.5);
  const maxChars = Math.max(6, Math.floor(slot / 6.2));
  /** Up to two lines under a column: words kept whole where they fit, the rest cut with an ellipsis. */
  const lines = (s: string): string[] => {
    const out: string[] = [];
    let cur = "";
    for (const w of s.split(/\s+/)) {
      if (!cur) cur = w;
      else if ((cur + " " + w).length <= maxChars) cur += " " + w;
      else { out.push(cur); cur = w; }
    }
    if (cur) out.push(cur);
    const two = out.slice(0, 2);
    if (out.length > 2) two[1] = `${two[1]}…`;
    return two.map((l) => (l.length > maxChars ? `${l.slice(0, maxChars - 1)}…` : l));
  };
  return (
    <div dir="ltr" ref={box} className="relative" data-testid={testId}>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="block max-w-full touch-pan-y" role="img" onPointerLeave={() => setHover(null)}
        aria-label={steps.map((s) => `${T.tl(s.label)} ${money(s.value, cur)}`).join(lang === "ar" ? "، " : ", ")}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pl} x2={w - pr} y1={Y(t)} y2={Y(t)} stroke={INK.grid} strokeWidth={1} />
            <text x={pl - 6} y={Y(t) + 4} className="ax" textAnchor="end">{compact(t, lang)}</text>
          </g>
        ))}
        <line x1={pl} x2={w - pr} y1={Y(0)} y2={Y(0)} stroke={INK.axis} />
        {steps.map((s, i) => {
          const top = Y(Math.max(s.from, s.to)), bot = Y(Math.min(s.from, s.to));
          const fill = s.kind === "total" ? TOTAL : s.kind === "up" ? TONE.good : TONE.bad;
          const next = steps[i + 1];
          return (
            <g key={i}>
              {next && <line x1={cx(i) + bw / 2} x2={cx(i + 1) - bw / 2} y1={Y(s.to)} y2={Y(s.to)} stroke={INK.axis} strokeDasharray="3 3" />}
              <motion.rect x={cx(i) - bw / 2} width={bw} rx={4} fill={fill} opacity={hover === null || hover === i ? 1 : 0.55}
                initial={st ? false : { y: Y(s.from), height: 0 }} animate={{ y: top, height: Math.max(2, bot - top) }} transition={{ duration: 0.5, delay: i * 0.04 }} />
              <text x={cx(i)} y={top - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill={s.kind === "total" ? INK.primary : s.kind === "up" ? TONE.goodText : TONE.badText}>
                {s.kind === "total" ? "" : s.value > 0 ? "+" : ""}{compact(s.value, lang)}
              </text>
              <text x={cx(i)} y={h - pb + 16} textAnchor="middle" fontSize={11} fill={s.kind === "total" ? INK.primary : INK.muted} fontWeight={s.kind === "total" ? 600 : 400}>
                <title>{T.tl(s.label)}</title>
                {lines(T.tl(s.label)).map((l, k) => <tspan key={k} x={cx(i)} dy={k ? 13 : 0}>{l}</tspan>)}
              </text>
              <rect x={pl + slot * i} y={pt} width={slot} height={h - pt - pb + 22} fill="transparent" onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      <ChartTip show={hover !== null} x={hover !== null ? (cx(hover) / w) * 100 : 0} y={30}>
        {hover !== null && (
          <>
            <div className="mb-0.5 font-semibold">{T.tl(steps[hover].label)}</div>
            <div className="num">{money(steps[hover].value, cur)}</div>
            {steps[hover].kind !== "total" && <div className="text-mute">{steps[hover].kind === "up" ? T.d.viz.up : T.d.viz.down}</div>}
            {steps[hover].gap !== 0 && <div className="text-red">{T.d.viz.gap(money(steps[hover].gap, cur))}</div>}
            {steps[hover].info && <div className="mt-1 max-w-64 whitespace-normal text-mute">{T.tl(steps[hover].info!)}</div>}
          </>
        )}
      </ChartTip>
    </div>
  );
}

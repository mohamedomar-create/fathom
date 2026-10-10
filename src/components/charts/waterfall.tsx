"use client";
import { Info } from "lucide-react";
import { motion } from "motion/react";
import { money, type WaterfallRow } from "@/lib/engine";
import { Tip } from "@/components/ui/tooltip";
import { niceTicks } from "./util";
import { useStaticCharts } from "./static";

/** Horizontal ADD/LESS waterfall. HTML rows + percentage geometry so it reflows on narrow screens. */
export function CashWaterfall({ rows, cur }: { rows: WaterfallRow[]; cur: string }) {
  const st = useStaticCharts();
  const spans = waterfallSpans(rows);
  const all = spans.flat().concat(0);
  let lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo) * 0.04; lo -= pad; hi += pad;
  const X = (v: number) => ((v - lo) / (hi - lo || 1)) * 100;
  const ticks = niceTicks(lo, hi, 4).filter((t) => t >= lo && t <= hi);
  return (
    <div className="text-[12.5px]" data-testid="waterfall">
      <div className="grid grid-cols-[minmax(120px,40%)_1fr] items-end gap-3 pb-1 sm:grid-cols-[minmax(240px,44%)_1fr]">
        <div />
        <div className="relative h-5">
          {ticks.map((t) => <span key={t} className="ax absolute -translate-x-1/2 text-[11px] text-mute" style={{ left: `${X(t)}%` }}>{money(t, cur, true)}</span>)}
        </div>
      </div>
      {rows.map((r, i) => {
        const [a, c] = spans[i];
        const x0 = Math.min(X(a), X(c)), x1 = Math.max(X(a), X(c));
        const pos = r.value >= 0;
        const total = r.sign === "TOTAL";
        const inside = x1 - x0 > 45;
        const labelRight = x1 < 70;
        return (
          <div key={r.label} className={`group grid grid-cols-[minmax(120px,40%)_1fr] items-center gap-3 sm:grid-cols-[minmax(240px,44%)_1fr] ${total ? "border-t border-ink pt-1 font-semibold" : ""}`}>
            <div className="flex items-center gap-2 py-[5px]">
              <span className="hidden w-9 shrink-0 text-[10px] tracking-wider text-mute sm:inline">{total ? "" : r.sign}</span>
              <span className={total ? "tracking-wide" : ""}>{r.label}</span>
              {r.info && !st && <Tip label={r.info} side="top"><button aria-label={`About ${r.label}`} className="text-mute hover:text-ink"><Info className="h-3.5 w-3.5" /></button></Tip>}
            </div>
            <div className="relative h-5">
              {ticks.map((t) => <span key={t} className="absolute inset-y-[-6px] w-px bg-[#efefeb]" style={{ left: `${X(t)}%` }} />)}
              {Math.abs(r.value) >= 0.5 && <motion.div
                initial={st ? false : { scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.5, delay: i * 0.03 }}
                className="absolute inset-y-[2px] origin-left rounded-[2px] group-hover:brightness-95"
                style={{ left: `${x0}%`, width: `max(${x1 - x0}%, 2px)`, background: pos ? "#2E9E6A" : "#D9343A", opacity: total ? 1 : 0.9 }}
              />}
              <span className={`num absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] ${inside ? "font-semibold text-white" : Math.abs(r.value) < 0.5 ? "text-mute" : pos ? "text-green-d" : "text-red"}`}
                style={inside ? { left: `calc(${x0}% + 8px)` } : labelRight ? { left: `calc(${x1}% + 6px)` } : { right: `calc(${100 - x0}% + 6px)` }}>
                {money(r.value, cur)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function waterfallSpans(rows: WaterfallRow[]): (readonly [number, number])[] {
  const out: (readonly [number, number])[] = [];
  let run = 0;
  for (const r of rows) {
    if (r.sign === "TOTAL") { run = r.value; out.push([0, r.value]); continue; }
    out.push([run, run + r.value]);
    run += r.value;
  }
  return out;
}

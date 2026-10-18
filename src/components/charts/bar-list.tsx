"use client";
import { useT } from "@/lib/i18n/use-t";
import { useState } from "react";
import { money, pct } from "@/lib/engine";
import { C } from "./util";

export interface BarItem { key: string; label: string; value: number; share?: number; sub?: string }

/**
 * Ranked horizontal bars: one hue, thin bars with rounded ends anchored at zero, the value written at the end of each bar
 * (text in ink, never the bar colour) and a hover line with the share. Negative values (refunds) are drawn in red to the left.
 */
export function BarList({ items, cur, max = 10, testId, onSelect }: { items: BarItem[]; cur: string; max?: number; testId?: string; onSelect?: (key: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const T = useT();
  // Rows with nothing in the period (they exist only in the comparison period) are neither drawn nor counted in "+N more".
  const live = items.filter((x) => x.value !== 0);
  const shown = live.slice(0, max);
  const rest = live.slice(max);
  const rows = rest.length ? [...shown, { key: "__other", label: T.d.ana.more(rest.length), value: rest.reduce((s, x) => s + x.value, 0), share: rest.reduce((s, x) => s + (x.share ?? 0), 0) }] : shown;
  const top = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  const anyNeg = rows.some((r) => r.value < 0);
  return (
    <div dir="ltr" className="space-y-1.5" data-testid={testId} role="list">
      {rows.map((r) => {
        const w = (Math.abs(r.value) / top) * (anyNeg ? 50 : 100);
        const click = onSelect && r.key !== "__other";
        return (
          <div key={r.key} role="listitem" className={`grid grid-cols-[minmax(0,38%)_1fr] items-center gap-3 rounded px-1 py-0.5 text-[13px] ${hover === r.key ? "bg-band" : ""} ${click ? "cursor-pointer" : ""}`}
            onMouseEnter={() => setHover(r.key)} onMouseLeave={() => setHover(null)} onClick={click ? () => onSelect!(r.key) : undefined}
            title={`${r.label}: ${money(r.value, cur)}${r.share !== undefined ? ` · ${T.d.ana.ofTotal2(pct(r.share, 1))}` : ""}`}>
            <div className="truncate" title={r.label}>{r.label}{r.sub && <span className="ml-1 text-mute">{r.sub}</span>}</div>
            <div className="relative flex h-5 items-center">
              {anyNeg && <span className="absolute left-1/2 top-0 h-full w-px bg-line" aria-hidden="true" />}
              <span className="absolute h-2.5 rounded-[4px]" style={{
                width: `${w}%`, background: r.value < 0 ? C.red : r.key === "__other" ? "#b8c4c4" : C.s[0],
                ...(anyNeg ? (r.value < 0 ? { right: "50%" } : { left: "50%" }) : { left: 0 }),
              }} />
              <span className="num absolute whitespace-nowrap text-[12px] text-ink" style={anyNeg ? (r.value < 0 ? { right: `calc(50% + ${w}% + 6px)` } : { left: `calc(50% + ${w}% + 6px)` }) : { left: `min(calc(${w}% + 6px), calc(100% - 70px))` }}>
                {money(r.value, cur, true)}{r.share !== undefined && hover === r.key ? ` · ${pct(r.share, 1)}` : ""}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

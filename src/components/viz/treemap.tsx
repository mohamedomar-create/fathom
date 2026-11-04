"use client";
import { useEffect, useRef, useState } from "react";
import { compact, money, pct } from "@/lib/engine/format";
import { useT } from "@/lib/i18n/use-t";
import { treemap } from "@/lib/viz/geometry";
import { ramp, rampInk } from "./palette";

export const OTHER = "#a9a9a3";
/** Tile fill: one blue ramp, largest tile darkest (`n` named tiles); Other stays grey. */
export const tileFill = (i: number, n: number) => (i < 0 ? OTHER : ramp(n)[i]);
/** Label ink that clears 4.5:1 on a tile's fill. */
export const inkOn = (fill: string) => (fill === OTHER ? "#0b0b0b" : rampInk(fill));

/** Share of a whole as tiles: at most 6 named tiles in one blue, light to dark, the rest folded into one grey Other. */
export function Treemap({ items, cur, height = 260, testId }: { items: { key: string; label: string; value: number }[]; cur: string; height?: number; testId?: string }) {
  const T = useT();
  const lang = T.lang === "ar" ? "ar" : "en";
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pos = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const total = pos.reduce((s, i) => s + i.value, 0);
  const named = pos.slice(0, 6);
  const rest = pos.slice(6);
  const list = [...named.map((i, k) => ({ ...i, k })), ...(rest.length ? [{ key: "__other", label: T.d.viz.other(rest.length), value: rest.reduce((s, i) => s + i.value, 0), k: -1 }] : [])];
  const tiles = treemap(list.map((i) => ({ key: i.key, value: i.value })), w, height);
  const by = new Map(list.map((i) => [i.key, i]));
  if (!total) return <p className="text-sm text-mute">{T.d.viz.noData}</p>;
  return (
    <div ref={box} className="relative" style={{ height }} data-testid={testId}>
      {tiles.map((t) => {
        const it = by.get(t.key)!;
        const bg = tileFill(it.k, named.length);
        const fg = inkOn(bg);
        const share = (t.value / total) * 100;
        const big = t.w > 70 && t.h > 38, mid = t.w > 44 && t.h > 22;
        const label = `${it.label}: ${money(t.value, cur)} (${pct(share, 1)})`;
        return (
          <div key={t.key} title={label} aria-label={label} role="img" className="absolute overflow-hidden rounded-md p-1.5 text-[11px] leading-tight"
            style={{ left: t.x + 1, top: t.y + 1, width: Math.max(0, t.w - 2), height: Math.max(0, t.h - 2), background: bg, color: fg }}>
            {big && <div className="truncate font-semibold">{it.label}</div>}
            {mid && <div className="tabular-nums">{big ? `${compact(t.value, lang)} · ` : ""}{pct(share, 0)}</div>}
          </div>
        );
      })}
    </div>
  );
}

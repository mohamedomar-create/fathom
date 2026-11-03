"use client";
import { cn } from "@/lib/cn";
import { pct } from "@/lib/engine/format";
import { useT } from "@/lib/i18n/use-t";
import { GHOST, TONE } from "./palette";

/**
 * A change as a badge: arrow, sign and % (never colour alone). `cost`: an increase is worse (costs, days to collect).
 * `pp`: the change is in percentage points (a margin moving from 30% to 32% is +2.0 pp).
 */
export function DeltaBadge({ value, cost, pp, className, label }: { value: number | null | undefined; cost?: boolean; pp?: boolean; className?: string; label?: string }) {
  const { d } = useT();
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className={cn("text-mute", className)}>–</span>;
  const flat = Math.abs(value) < 0.05;
  const good = flat ? null : (value > 0) !== !!cost;
  const tone = good === null ? "bg-band text-mute" : good ? "bg-green-bg text-green-d" : "bg-red-bg text-red";
  const text = `${value > 0 ? "+" : ""}${pp ? `${value.toFixed(1)} pp` : pct(value, 1)}`;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold tabular-nums", tone, className)}
      data-tone={good === null ? "neutral" : good ? "good" : "bad"}>
      <span aria-hidden className="text-[9px]">{flat ? "▬" : value > 0 ? "▲" : "▼"}</span>{text}
      {good !== null && <span className="sr-only"> ({good ? d.viz.better : d.viz.worse})</span>}
      {label && <span className="font-normal opacity-80">{label}</span>}
    </span>
  );
}

/** A small trend: this period's line over last year's (grey), on one scale; the last point marked. */
export function TrendSpark({ now, last, w = 120, h = 32, color = "#0b6e70", testId }: { now: (number | null)[]; last?: (number | null)[]; w?: number; h?: number; color?: string; testId?: string }) {
  const ok = (x: number | null | undefined): x is number => x !== null && x !== undefined && Number.isFinite(x);
  const all = [...now, ...(last ?? [])].filter(ok);
  if (now.filter(ok).length < 2) return null;
  const lo = Math.min(...all), hi = Math.max(...all), rng = hi - lo || 1;
  const n = Math.max(now.length, last?.length ?? 0);
  const X = (i: number) => 2 + ((w - 6) * i) / Math.max(1, n - 1);
  const Y = (v: number) => h - 3 - (h - 6) * ((v - lo) / rng);
  const path = (vs: (number | null)[]) => {
    let d = "", pen = false;
    vs.forEach((v, i) => { if (!ok(v)) { pen = false; return; } d += `${pen ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)} `; pen = true; });
    return d;
  };
  const li = now.map((v, i) => (ok(v) ? i : -1)).filter((i) => i >= 0).pop()!;
  const area = `${path(now)} L${X(li).toFixed(1)},${h - 1} L${X(now.findIndex(ok)).toFixed(1)},${h - 1} Z`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="block" data-testid={testId}>
      {last && last.filter(ok).length > 1 && <path d={path(last)} fill="none" stroke={GHOST} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />}
      <path d={area} fill={color} opacity={0.08} />
      <path d={path(now)} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={X(li)} cy={Y(now[li]!)} r={3} fill={color} stroke="#fff" strokeWidth={1.5} />
    </svg>
  );
}

/**
 * The page's headline figure: big number, its change, its trend and one plain sentence. The band sits at the top of a page.
 */
export function HeroKpi({ label, value, delta, deltaLabel, cost, pp, story, now, last, neg, testId, children }: {
  label: string; value: React.ReactNode; delta?: number | null; deltaLabel?: string; cost?: boolean; pp?: boolean; story?: React.ReactNode;
  now?: (number | null)[]; last?: (number | null)[]; neg?: boolean; testId?: string; children?: React.ReactNode;
}) {
  return (
    <div className="fade-up flex min-w-0 flex-col justify-between gap-3 rounded-xl border border-line bg-gradient-to-br from-brand-bg/70 via-white to-white p-5 sm:p-6" data-testid={testId}>
      <div>
        <div className="label">{label}</div>
        <div className={cn("t-hero mt-2 whitespace-nowrap", neg ? "text-red" : "text-ink")} data-testid={testId ? `${testId}-value` : undefined}>{value}</div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">{delta !== undefined && <DeltaBadge value={delta} cost={cost} pp={pp} />}{deltaLabel && <span className="text-mute">{deltaLabel}</span>}</div>
      </div>
      {now && <TrendSpark now={now} last={last} w={260} h={54} color={neg ? TONE.badText : "#0b6e70"} />}
      {story && <p className="max-w-prose text-[13.5px] leading-relaxed text-ink-2">{story}</p>}
      {children}
    </div>
  );
}

/** A supporting KPI tile for the cockpit band. */
export function KpiTile({ label, value, sub, delta, cost, pp, now, last, neg, accent, testId, children }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; delta?: number | null; cost?: boolean; pp?: boolean;
  now?: (number | null)[]; last?: (number | null)[]; neg?: boolean;
  /** A thin top edge saying whether the figure reads well (green) or needs attention (red), beside its words. */
  accent?: "good" | "bad"; testId?: string; children?: React.ReactNode;
}) {
  return (
    <div className={cn("fade-up flex min-w-0 flex-col gap-1 rounded-xl border border-line bg-white p-4", accent === "good" && "border-t-[3px] border-t-green", accent === "bad" && "border-t-[3px] border-t-red")} data-testid={testId}>
      <div className="label truncate">{label}</div>
      <div className="flex items-end justify-between gap-2">
        <div className={cn("t-kpi whitespace-nowrap", neg && "text-red")}>{value}</div>
        {now && <TrendSpark now={now} last={last} w={84} h={28} color={neg ? TONE.badText : "#0b6e70"} />}
      </div>
      {(delta !== undefined || sub) && <div className="flex flex-wrap items-center gap-1.5 text-xs">{delta !== undefined && <DeltaBadge value={delta} cost={cost} pp={pp} />}{sub && <span className="text-mute">{sub}</span>}</div>}
      {children}
    </div>
  );
}

/** The cockpit band: hero on the left (or top on phones), the supporting tiles in a grid beside it. */
export function Cockpit({ hero, children, testId }: { hero: React.ReactNode; children: React.ReactNode; testId?: string }) {
  return (
    <section className="mb-8 grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]" data-testid={testId ?? "cockpit"}>
      {hero}
      <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2">{children}</div>
    </section>
  );
}

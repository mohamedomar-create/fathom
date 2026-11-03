"use client";
import { useRef, useState, type ReactNode } from "react";
import { compact, num, pct } from "@/lib/engine/format";
import { changeBadge } from "@/lib/engine/budget-visual";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/use-t";

/** A whole amount with thousands commas (the exact figure, the same in both languages). */
export const amt = (v: number) => num(Math.round(v), "num").replace(/\.00$/, "");

/** The compact form in the page's language (2.8M / 2.8 م). */
export function useCompact() {
  const { lang } = useT();
  return (v: number) => compact(v, lang === "ar" ? "ar" : "en");
}

/**
 * An amount in compact form with the exact amount on hover (title), on tap or click (the text swaps to it) and while it has
 * keyboard focus (Tab reaches it; Enter swaps back), so a screen reader reads the exact figure. A focusable text, not a
 * button: a table of buttons would fail the target-size rule wherever a sticky total row covers part of a row.
 * `plain`: text only, not focusable (inside a label or another control).
 */
export function Amt({ v, className, testId, plain }: { v: number; className?: string; testId?: string; plain?: boolean }) {
  const fmt = useCompact();
  const [exact, setExact] = useState(false);
  const pointer = useRef(false);
  if (plain) return <span className={cn("tabular-nums", className)} title={amt(v)} data-exact={amt(v)} data-testid={testId}>{fmt(v)}</span>;
  return (
    <span tabIndex={0} className={cn("cursor-help rounded tabular-nums decoration-dotted underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-d", className)}
      title={amt(v)} data-exact={amt(v)} data-testid={testId}
      onPointerDown={() => { pointer.current = true; }}
      onFocus={() => { if (!pointer.current) setExact(true); pointer.current = false; }}
      onBlur={() => setExact(false)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExact((x) => !x); } }}
      onClick={(e) => { e.stopPropagation(); setExact((x) => !x); }}>{exact ? amt(v) : fmt(v)}</span>
  );
}

/**
 * A row's months: last year (muted) and the new year (brand) on one scale, so the shape and the level compare at a glance.
 */
export function TwoSpark({ last, now, w = 84, h = 24 }: { last: number[]; now: number[]; w?: number; h?: number }) {
  const all = [...last, ...now].filter((x) => Number.isFinite(x));
  const hasLast = last.some((x) => x !== 0);
  if (!all.length || all.every((x) => x === 0)) return <svg width={w} height={h} aria-hidden />;
  // One scale for both lines (their own range, not from zero), so the shapes show and the levels still compare.
  const lo = Math.min(...all), hi = Math.max(...all), rng = hi - lo || 1;
  const path = (vs: number[]) => "M" + vs.map((x, i) => `${(2 + ((w - 6) * i) / Math.max(1, vs.length - 1)).toFixed(1)},${(h - 3 - (h - 6) * ((x - lo) / rng)).toFixed(1)}`).join(" L");
  const endY = h - 3 - (h - 6) * ((now[now.length - 1] - lo) / rng);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="block">
      {hasLast && <path d={path(last)} fill="none" stroke="#b8c4c4" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />}
      <path d={path(now)} fill="none" stroke="#2a78d6" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={w - 4} cy={endY} r={2.5} fill="#2a78d6" stroke="#fff" strokeWidth={1} />
    </svg>
  );
}

/**
 * The change from the estimate to the new year: arrow, sign and % (not colour alone), green when good and red when bad.
 * For a cost (`cost`) an increase is bad.
 */
export function ChangeBadge({ now, est, cost, className }: { now: number; est: number; cost?: boolean; className?: string }) {
  const { d } = useT();
  const b = d.bud.b;
  const x = changeBadge(now, est, cost);
  if (x.pct === null) return <span className={cn("text-mute", className)}>–</span>;
  const tone = x.tone === "good" ? "bg-green-bg text-green-d" : x.tone === "bad" ? "bg-red-bg text-red" : "bg-band text-mute";
  const arrow = x.dir === "up" ? "▲" : x.dir === "down" ? "▼" : "▬";
  const text = `${x.pct > 0 ? "+" : ""}${pct(x.pct, 1)}`;
  return (
    <span className={cn("inline-flex items-center gap-0.5 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums", tone, className)} data-tone={x.tone} data-dir={x.dir}
      title={`${b[x.dir]} ${text}${x.tone !== "neutral" ? ` (${x.tone === "good" ? b.better : b.worse})` : ""}`}>
      <span aria-hidden className="text-[9px]">{arrow}</span>{text}
      {x.tone !== "neutral" && <span className="sr-only"> ({x.tone === "good" ? b.better : b.worse})</span>}
    </span>
  );
}

/** A thin bar for a revenue row's share of the revenue, with the % beside it. */
export function ShareBar({ share }: { share: number }) {
  const { d } = useT();
  const p = pct(share * 100, 1);
  return (
    <div className="mt-0.5 flex items-center gap-1.5" title={d.bud.b.shareOf(p)}>
      <div className="h-1 w-16 overflow-hidden rounded-full bg-band sm:w-24" aria-hidden>
        <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%`, background: "#2a78d6" }} />
      </div>
      <span className="text-[10px] tabular-nums text-mute">{p}</span>
    </div>
  );
}

export interface CardFigure { key: "revenue" | "gp" | "exp" | "np"; now: number; est: number; margin?: number | null; cost?: boolean; testId?: string }

/** The four summary cards: the new year (compact), this year's estimate and the change; margins on the profits. */
export function BudgetCards({ figures, fy, note, cur }: { figures: CardFigure[]; fy: string; note: string; cur: string }) {
  const { d } = useT();
  const fmt = useCompact();
  const b = d.bud.b;
  return (
    <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4" data-testid="bsheet-strip" title={note}>
      {figures.map((f) => (
        <div key={f.key} className="rounded-lg border border-line bg-white p-3" data-testid={`bcards-${f.key}`} title={f.key === "exp" ? b.expHint : undefined}>
          <div className="text-xs text-mute">{b.cards[f.key]} ({cur}) · {d.bud.fy(fy)}</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <Amt v={f.now} className={cn("text-2xl font-semibold [font-variant-numeric:normal]", f.now < 0 && "text-red-d")} testId={f.testId} />
            <ChangeBadge now={f.now} est={f.est} cost={f.cost} />
          </div>
          <div className="mt-1 text-xs text-mute">
            <span title={amt(f.est)}>{b.vsEst(fmt(f.est))}</span>
            {f.margin !== undefined && f.margin !== null && <span> · {b.margin(pct(f.margin, 1))}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A chart's frame: a title, a short note, the chart and a text alternative for screen readers. */
export function ChartCard({ testId, title, note, summary, children, extra }: { testId: string; title: string; note?: string; summary: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <figure className="mb-4 rounded-lg border border-line bg-white p-3" data-testid={testId} aria-label={title}>
      <figcaption className="mb-2 flex flex-wrap items-baseline gap-x-3">
        <span className="font-medium">{title}</span>
        {note && <span className="text-xs text-mute">{note}</span>}
        {extra && <span className="ms-auto">{extra}</span>}
      </figcaption>
      {children}
      <p className="sr-only">{summary}</p>
    </figure>
  );
}

/** One whole split into parts (a segmented bar) with a legend that carries the names, amounts and shares; each part's colour is fixed by its key, not its rank. */
export function SplitBar({ parts, testId }: { parts: { key: string; label: string; value: number; color: string }[]; testId?: string }) {
  const fmt = useCompact();
  const live = parts.filter((p) => p.value > 0);
  const total = live.reduce((t, p) => t + p.value, 0) || 1;
  return (
    <div data-testid={testId}>
      <div dir="ltr" className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full" aria-hidden>
        {live.map((p) => {
          const share = p.value / total;
          return (
            <div key={p.key} className="h-full first:rounded-s-full last:rounded-e-full" style={{ width: `${share * 100}%`, background: p.color }} title={`${p.label}: ${amt(p.value)} · ${pct(share * 100, 1)}`} />
          );
        })}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {live.map((p) => (
          <li key={p.key} className="flex items-center gap-1.5">
            <i aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
            <span>{p.label}</span>
            <span className="tabular-nums text-mute" title={amt(p.value)}>{fmt(p.value)} · {pct((p.value / total) * 100, 1)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

"use client";
import type { MethodResult, Range } from "@/lib/engine/valuation";

/**
 * Every method's range of equity value on one scale: a bar from low to high with a dot at the central figure, and the
 * best estimate as a shaded band behind them. Methods that don't apply are listed with the reason instead of a bar.
 */
export function FootballField({ methods, best, label, fmt, reason, weightOf }: {
  methods: MethodResult[]; best: Range; label: (k: string) => string; fmt: (v: number) => string; reason: (r?: string) => string; weightOf: (k: string) => number;
}) {
  const shown = methods.filter((m) => m.value);
  const vals = shown.flatMap((m) => [m.value!.low, m.value!.high]).concat(best.low, best.high, 0);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || 1;
  const at = (v: number) => `${((v - lo) / span) * 100}%`;
  const width = (a: number, b: number) => `${(Math.max(0, b - a) / span) * 100}%`;
  return (
    <div data-testid="football-field">
      <div>
        <ul className="space-y-3">
          {methods.map((m) => (
            <li key={m.key} className="grid grid-cols-[11rem_1fr] items-center gap-0 text-sm" data-testid={`ff-${m.key}`}>
              <span className={m.value ? "pe-2" : "pe-2 text-mute"}>
                {label(m.key)}
                {m.value && weightOf(m.key) > 0 ? <span className="ms-1 text-xs text-mute">· {Math.round(weightOf(m.key) * 100)}%</span> : null}
              </span>
              {m.value ? (
                <span dir="ltr" className="relative block h-6" title={`${fmt(m.value.low)} – ${fmt(m.value.high)}`}>
                  <span aria-hidden className="absolute inset-y-0 bg-brand/10" style={{ left: at(best.low), width: width(best.low, best.high) }} />
                  <span className="absolute top-2 h-2 rounded-full bg-brand/70" style={{ left: at(m.value.low), width: width(m.value.low, m.value.high) }} />
                  <span className="absolute top-1 h-4 w-4 -translate-x-1/2 rounded-full border-2 border-white bg-ink" style={{ left: at(m.value.mid) }} />
                  <span className="sr-only">{fmt(m.value.low)} – {fmt(m.value.mid)} – {fmt(m.value.high)}</span>
                </span>
              ) : <span className="text-xs text-mute">{reason(m.reason)}</span>}
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-2 grid grid-cols-[11rem_1fr] text-xs text-mute num">
        <span />
        <span dir="ltr" className="flex justify-between"><span>{fmt(lo)}</span><span>{fmt(hi)}</span></span>
      </div>
    </div>
  );
}

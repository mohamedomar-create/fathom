"use client";
import { money, pct } from "@/lib/engine/format";
import { STATUS } from "./palette";

/** Bucket colours from on-time to oldest: the reserved status ramp, always beside the bucket's name and amount. */
const RAMP = [STATUS.good, "#9ccc3c", STATUS.warning, STATUS.serious, STATUS.critical, "#9b2226"];
const colourAt = (i: number, n: number) => RAMP[n <= 1 ? 0 : Math.round((i / (n - 1)) * (RAMP.length - 1))];

/**
 * One stacked bar of what is owed by age (oldest on the right), then each bucket as a row: swatch, name, amount and share.
 * Negative buckets (credits) are left out of the bar and shown in their row.
 */
export function AgeingStack({ buckets, cur, testId, note, compact }: { buckets: { label: string; value: number }[]; cur: string; testId?: string; note?: string; /** Only the bar, with a one-line legend (in a hero). */ compact?: boolean }) {
  const total = buckets.reduce((s, b) => s + Math.max(0, b.value), 0);
  return (
    <div data-testid={testId}>
      <div dir="ltr" className="flex h-4 w-full overflow-hidden rounded-full bg-band" aria-hidden>
        {buckets.map((b, i) => b.value > 0 && total ? (
          <span key={b.label} className="h-full border-e-2 border-white last:border-e-0" style={{ width: `${(b.value / total) * 100}%`, background: colourAt(i, buckets.length) }} />
        ) : null)}
      </div>
      {compact ? (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-mute">
          {buckets.map((b, i) => <span key={b.label} className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-sm" style={{ background: colourAt(i, buckets.length) }} aria-hidden />{b.label}</span>)}
        </div>
      ) : <ul className="mt-3 space-y-1.5">
        {buckets.map((b, i) => (
          <li key={b.label} className="grid grid-cols-[12px_minmax(0,1fr)_auto_3.5rem] items-center gap-2 text-[13px]">
            <i className="h-3 w-3 rounded-sm" style={{ background: colourAt(i, buckets.length) }} aria-hidden />
            <span className="truncate text-mute">{b.label}</span>
            <span className={b.value < 0 ? "num text-red" : "num font-medium"}>{money(b.value, cur)}</span>
            <span className="num text-end text-mute">{total && b.value > 0 ? pct((b.value / total) * 100, 0) : ""}</span>
          </li>
        ))}
      </ul>}
      {note && <p className="mt-2 text-[12px] text-mute">{note}</p>}
    </div>
  );
}

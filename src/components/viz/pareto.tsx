"use client";
import { cn } from "@/lib/cn";
import { money, pct } from "@/lib/engine/format";
import { useT } from "@/lib/i18n/use-t";
import { pareto, type ParetoItem } from "@/lib/viz/geometry";

/**
 * Ranked items as bars on one amount scale, with each item's share and the running share as text (never a second axis).
 * A rule marks where the running share reaches 80%. Clicking a row calls onSelect.
 */
export function ParetoList({ items, cur, max = 10, testId, onSelect }: { items: ParetoItem[]; cur: string; max?: number; testId?: string; onSelect?: (key: string) => void }) {
  const T = useT();
  const p = pareto(items, max);
  if (!p.items.length) return <p className="text-sm text-mute">{T.d.viz.noData}</p>;
  const top = p.items[0].value;
  return (
    <div data-testid={testId}>
      <div className="mb-1 grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_3.5rem_3.5rem] gap-2 text-[10.5px] uppercase tracking-wide text-mute">
        <span>{T.d.viz.item}</span><span /><span className="text-end">{T.d.viz.share}</span><span className="text-end">{T.d.viz.cum}</span>
      </div>
      {p.items.map((it, i) => (
        <div key={it.key}>
          <button type="button" onClick={onSelect ? () => onSelect(it.key) : undefined} disabled={!onSelect}
            className={cn("grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_3.5rem_3.5rem] items-center gap-2 rounded py-1 text-start text-[12.5px]", onSelect && "hover:bg-band")}
            title={`${it.label ?? it.key}: ${money(it.value, cur)}`}>
            <span className="truncate">{T.tl(it.label ?? it.key)}</span>
            <span dir="ltr" className="flex items-center gap-1.5">
              <span className="h-3 rounded-[3px]" style={{ width: `${Math.max(2, (it.value / top) * 100)}%`, background: i <= p.at80 || p.at80 < 0 ? "#0b6e70" : "#9fc9c9" }} />
            </span>
            <span className="text-end tabular-nums">{pct(it.share, 1)}</span>
            <span className="text-end tabular-nums text-mute">{pct(it.cum, 0)}</span>
          </button>
          {i === p.at80 && i < p.items.length - 1 && (
            <div className="my-1 flex items-center gap-2 text-[10.5px] text-mute" aria-hidden><span className="h-px flex-1 border-t border-dashed border-ink/40" />{T.d.viz.reach80}<span className="h-px flex-1 border-t border-dashed border-ink/40" /></div>
          )}
        </div>
      ))}
      {p.other && (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_3.5rem_3.5rem] items-center gap-2 border-t border-line pt-1 text-[12.5px] text-mute">
          <span>{T.d.viz.other(p.other.count)}</span><span /><span className="text-end tabular-nums">{pct(p.other.share, 1)}</span><span className="text-end">100%</span>
        </div>
      )}
    </div>
  );
}

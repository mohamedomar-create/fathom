"use client";
import { money, pct } from "@/lib/engine/format";
import { ramp, rampInk } from "./palette";

/** One bar split into the parts of a whole (one blue, largest darkest), with the % inside wide parts and a legend with the amounts. */
export function ShareBar({ parts, cur, testId, label }: { parts: { label: string; value: number }[]; cur: string; testId?: string; label?: string }) {
  const pos = parts.filter((p) => p.value > 0);
  const total = pos.reduce((s, p) => s + p.value, 0);
  const order = [...pos].sort((a, b) => b.value - a.value);
  const colour = new Map(order.map((p, i) => [p.label, ramp(order.length)[i]]));
  if (!total) return <p className="text-sm text-mute" data-testid={testId}>–</p>;
  return (
    <div data-testid={testId}>
      <div dir="ltr" className="flex h-7 w-full overflow-hidden rounded-md" role="img" aria-label={`${label ? label + ": " : ""}${pos.map((p) => `${p.label} ${pct((p.value / total) * 100, 0)}`).join(", ")}`}>
        {pos.map((p) => {
          const share = (p.value / total) * 100, bg = colour.get(p.label)!;
          return <span key={p.label} className="flex h-full items-center justify-center border-e-2 border-white text-[11px] font-semibold last:border-e-0" style={{ width: `${share}%`, background: bg, color: rampInk(bg) }}>{share >= 9 ? pct(share, 0) : ""}</span>;
        })}
      </div>
      <ul className="mt-3 grid gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-2">
        {pos.map((p) => (
          <li key={p.label} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 text-mute"><i className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: colour.get(p.label) }} aria-hidden /><span className="truncate">{p.label}</span></span>
            <span className="num shrink-0 font-medium">{money(p.value, cur, true)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

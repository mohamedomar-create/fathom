import { money } from "@/lib/engine/format";
import type { LandingFigures } from "@/lib/landing/figures";

/** Bars of the twelve months, scaled to the box (decorative: the figure beside it carries the meaning). */
function Bars({ values, color }: { values: number[]; color: string }) {
  const hi = Math.max(...values.map(Math.abs), 1);
  return (
    <svg viewBox="0 0 240 64" className="h-16 w-full" preserveAspectRatio="none" aria-hidden>
      {values.map((v, i) => {
        const h = Math.max(3, (Math.abs(v) / hi) * 58);
        return <rect key={i} x={i * 20 + 3} y={64 - h} width="14" height={h} rx="4" fill={color} opacity={0.35 + (0.65 * i) / values.length} />;
      })}
    </svg>
  );
}

/**
 * The little picture on each feature card, drawn from the demo company's own figures: monthly revenue, cash, the
 * value range, the books health score, a bank-style gauge and the two languages.
 */
export function BentoVisual({ i, f, labels }: { i: number; f: LandingFigures; labels: { gpm: string; cash: string } }) {
  const cur = f.currency;
  if (i === 0) return (
    <div className="mt-5 flex items-end gap-4">
      <div className="min-w-0 flex-1"><Bars values={f.series.revenue} color="#0f8b8d" /></div>
      <div className="shrink-0 text-end"><div className="text-xs text-mute">{labels.gpm}</div><div className="text-2xl font-semibold num">{f.gpm.toFixed(1)}%</div></div>
    </div>
  );
  if (i === 1) return (
    <div className="mt-5 rounded-xl bg-band px-4 py-3">
      <div className="flex items-baseline justify-between"><span className="text-xs text-mute">{labels.cash}</span><span className="text-lg font-semibold num">{money(f.cash, cur, true)}</span></div>
      <div className="mt-2 flex h-2 gap-1" aria-hidden>{[0.9, 0.75, 0.6].map((w, k) => <div key={k} className="rounded-full bg-s1" style={{ width: `${w * 33}%`, opacity: 1 - k * 0.25 }} />)}</div>
    </div>
  );
  if (i === 2) return (
    <div className="mt-5">
      <div className="relative h-3 rounded-full bg-gradient-to-r from-brand-bg via-s1/40 to-s7/50" aria-hidden>
        <span className="absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border-4 border-white bg-s7 shadow" style={{ insetInlineStart: `calc(${Math.min(96, (f.value.fair / f.value.highest) * 100)}% - 10px)` }} />
      </div>
      <div className="mt-2 flex justify-between text-xs text-mute num"><span>{money(f.value.low, cur, true)}</span><span className="font-semibold text-ink">{money(f.value.fair, cur, true)}</span><span>{money(f.value.highest, cur, true)}</span></div>
    </div>
  );
  if (i === 3) return (
    <div className="mt-5 flex items-center gap-4">
      <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full border-[6px] border-green-bg text-xl font-semibold num" style={{ borderTopColor: "#2e9e6a", borderInlineEndColor: "#2e9e6a" }}>{f.doctor.score}</div>
      <ul className="min-w-0 flex-1 space-y-1.5 text-xs text-ink-2" aria-hidden>
        {[0.85, 0.65, 0.45].map((w, k) => <li key={k} className="flex items-center gap-2"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber" /><span className="h-1.5 rounded-full bg-band" style={{ width: `${w * 100}%` }} /></li>)}
      </ul>
    </div>
  );
  if (i === 4) return (
    <svg viewBox="0 0 200 70" className="mt-4 h-16 w-full" aria-hidden>
      <path d="M20 64 A80 80 0 0 1 180 64" fill="none" stroke="#eef1f1" strokeWidth="12" strokeLinecap="round" />
      <path d="M20 64 A80 80 0 0 1 150 22" fill="none" stroke="#e0a526" strokeWidth="12" strokeLinecap="round" />
      <line x1="100" y1="64" x2="142" y2="30" stroke="#222" strokeWidth="3" strokeLinecap="round" /><circle cx="100" cy="64" r="5" fill="#222" />
    </svg>
  );
  return (
    <div className="mt-5 grid grid-cols-2 gap-2 text-sm" aria-hidden>
      <div className="rounded-lg bg-band px-3 py-2 font-medium" dir="ltr">Net profit</div>
      <div className="rounded-lg bg-band px-3 py-2 text-end font-medium" dir="rtl" lang="ar">صافي الربح</div>
    </div>
  );
}

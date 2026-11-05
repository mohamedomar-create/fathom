import { Activity, Banknote, Gem, Stethoscope } from "lucide-react";
import { money, pct } from "@/lib/engine/format";
import type { LandingFigures } from "@/lib/landing/figures";

type D = {
  live: string; revenue: string; cash: string; value: string; doctor: string;
  doctorFound: (n: number, at: string) => string; valueRange: (lo: string, hi: string) => string; onTrack: (p: string) => string;
};

/** A path through the values, scaled to the box: the line and the area under it. */
function paths(values: number[], w: number, h: number, pad = 6) {
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const pts = values.map((v, i) => [pad + (i * (w - 2 * pad)) / (values.length - 1), pad + (1 - (v - lo) / span) * (h - 2 * pad)]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return { line, area: `${line} L${pts.at(-1)![0].toFixed(1)},${h} L${pts[0][0].toFixed(1)},${h} Z`, last: pts.at(-1)! };
}

/** A ring filled to a share, with the figure in the middle. */
function Ring({ share, label, color }: { share: number; label: string; color: string }) {
  const r = 26, c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 64 64" className="h-16 w-16 shrink-0" aria-hidden>
      <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="7" />
      <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${c * Math.max(0, Math.min(1, share))} ${c}`} transform="rotate(-90 32 32)" />
      <text x="32" y="36.5" textAnchor="middle" fontSize="13" fontWeight="600" fill="#fff">{label}</text>
    </svg>
  );
}

/**
 * The hero's glass dashboard: the demo company's revenue and profit over twelve months, and floating cards with its
 * cash, what it is worth and how healthy its books are. Every figure is the engine's own output on the demo books.
 */
export function HeroDashboard({ f, d }: { f: LandingFigures; d: D }) {
  const W = 520, H = 170;
  const rev = paths(f.series.revenue, W, H);
  const cur = f.currency;
  const doctorShare = f.doctor.score / 100;
  return (
    <div className="relative mx-auto w-full max-w-[640px] lg:pb-20 lg:pt-24" data-testid="hero-dashboard">
      <div className="lp-glass lp-float rounded-2xl p-5 sm:p-6" data-testid="glass-revenue">
        <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wider lp-mute"><span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-300" aria-hidden />{d.live} · {f.company}</div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-sm lp-mute">{d.revenue}</div>
            <div className="text-4xl font-semibold tracking-tight num sm:text-5xl">{money(f.revenue, cur, true)}</div>
            <div className="mt-1 text-sm lp-mute">{d.onTrack(pct(f.kpiOnTrack * 100, 0))}</div>
          </div>
          <Ring share={f.kpiOnTrack} label={pct(f.kpiOnTrack * 100, 0)} color="#7ff0e0" />
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 h-40 w-full" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="lp-rev" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#7ff0e0" stopOpacity=".45" /><stop offset="1" stopColor="#7ff0e0" stopOpacity="0" /></linearGradient>
          </defs>
          <path d={rev.area} fill="url(#lp-rev)" />
          <path d={rev.line} fill="none" stroke="#7ff0e0" strokeWidth="2.5" className="lp-draw" vectorEffect="non-scaling-stroke" />
          <circle cx={rev.last[0]} cy={rev.last[1]} r="5" fill="#7ff0e0" />
        </svg>
        <div className="mt-2 flex gap-5 text-xs lp-mute"><span className="flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" aria-hidden />{d.revenue}</span></div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3 lg:mt-0 lg:block">
        <div className="lp-glass lp-glass-strong lp-float-2 rounded-xl p-4 lg:absolute lg:-start-6 lg:bottom-0 lg:w-52" data-testid="glass-cash">
          <div className="flex items-center gap-2 text-xs lp-mute"><Banknote className="h-4 w-4 text-emerald-300" aria-hidden />{d.cash}</div>
          <div className="mt-1 text-2xl font-semibold num">{money(f.cash, cur, true)}</div>
        </div>
        <div className="lp-glass lp-glass-strong lp-shine lp-float relative rounded-xl p-4 lg:absolute lg:-end-6 lg:top-0 lg:w-64" data-testid="glass-value">
          <div className="flex items-center gap-2 text-xs lp-mute"><Gem className="h-4 w-4 text-violet-200" aria-hidden />{d.value}</div>
          <div className="mt-1 text-2xl font-semibold num">{money(f.value.fair, cur, true)}</div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/15" aria-hidden><div className="h-full rounded-full bg-gradient-to-r from-teal-300 via-sky-300 to-violet-300" style={{ width: `${Math.min(100, (f.value.fair / f.value.highest) * 100)}%` }} /></div>
          <div className="mt-1 text-xs lp-mute">{d.valueRange(money(f.value.low, cur, true), money(f.value.high, cur, true))}</div>
        </div>
        <div className="lp-glass lp-glass-strong lp-float-2 flex items-center gap-3 rounded-xl p-4 lg:absolute lg:bottom-0 lg:-end-6 lg:w-64" data-testid="glass-doctor">
          <Ring share={doctorShare} label={String(f.doctor.score)} color="#a7f3d0" />
          <div>
            <div className="flex items-center gap-2 text-xs lp-mute"><Stethoscope className="h-4 w-4 text-emerald-200" aria-hidden />{d.doctor}</div>
            <div className="mt-1 text-sm">{d.doctorFound(f.doctor.findings, money(f.doctor.atStake, cur, true))}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

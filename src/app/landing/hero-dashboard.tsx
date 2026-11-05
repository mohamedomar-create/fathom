import Image from "next/image";
import { Banknote, Gem, Stethoscope } from "lucide-react";
import { money, pct } from "@/lib/engine/format";
import type { LandingFigures } from "@/lib/landing/figures";
import summaryEn from "../landing-shots/summary-en.jpg";
import summaryAr from "../landing-shots/summary-ar.jpg";

type D = {
  live: string; revenue: string; cash: string; value: string; doctor: string;
  doctorFound: (n: number, at: string) => string; valueRange: (lo: string, hi: string) => string; onTrack: (p: string) => string;
  shots: Record<string, readonly [string, string]>;
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
    <svg viewBox="0 0 64 64" className="h-14 w-14 shrink-0" aria-hidden>
      <circle cx="32" cy="32" r={r} fill="none" stroke="#e6ecec" strokeWidth="7" />
      <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${c * Math.max(0, Math.min(1, share))} ${c}`} transform="rotate(-90 32 32)" />
      <text x="32" y="36.5" textAnchor="middle" fontSize="13" fontWeight="600" fill="#222">{label}</text>
    </svg>
  );
}

/**
 * The hero stage: a real screen of the product, tilted in a browser frame, with frosted cards floating over it that
 * carry the demo company's revenue, cash, worth and books health. Every figure is the engine's own output.
 */
export function HeroDashboard({ f, d, lang }: { f: LandingFigures; d: D; lang: "en" | "ar" }) {
  const W = 320, H = 96;
  const rev = paths(f.series.revenue, W, H);
  const cur = f.currency;
  return (
    <div className="lp-stage relative mx-auto w-full max-w-[680px] pb-4 lg:pb-16" data-testid="hero-dashboard">
      <div className="lp-tilt relative">
        <div className="lp-glass rounded-2xl p-2">
          <div className="mb-2 flex items-center gap-1.5 px-2 pt-1" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" /><span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" /><span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
            <span className="ms-3 h-5 flex-1 rounded-md bg-band" />
          </div>
          <Image src={lang === "ar" ? summaryAr : summaryEn} alt={d.shots.summary[1]} priority sizes="(max-width: 1024px) 100vw, 680px" className="h-auto w-full rounded-xl" placeholder="blur" />
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:mt-0 lg:block">
        <div className="lp-glass lp-float rounded-2xl p-4 lg:absolute lg:-start-10 lg:bottom-2 lg:w-[300px]" data-testid="glass-revenue">
          <div className="flex items-center gap-2 text-xs font-medium text-mute"><span className="inline-block h-2 w-2 animate-pulse rounded-full bg-green" aria-hidden />{d.live} · {f.company}</div>
          <div className="mt-2 flex items-end justify-between gap-3">
            <div>
              <div className="text-xs text-mute">{d.revenue}</div>
              <div className="text-2xl font-semibold tracking-tight num">{money(f.revenue, cur, true)}</div>
            </div>
            <span className="rounded-full bg-green-bg px-2 py-0.5 text-xs font-medium text-green-d">{d.onTrack(pct(f.kpiOnTrack * 100, 0))}</span>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-20 w-full" preserveAspectRatio="none" aria-hidden>
            <defs><linearGradient id="lp-rev" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#0f8b8d" stopOpacity=".28" /><stop offset="1" stopColor="#0f8b8d" stopOpacity="0" /></linearGradient></defs>
            <path d={rev.area} fill="url(#lp-rev)" />
            <path d={rev.line} fill="none" stroke="#0f8b8d" strokeWidth="2.5" className="lp-draw" vectorEffect="non-scaling-stroke" />
            <circle cx={rev.last[0]} cy={rev.last[1]} r="4" fill="#0f8b8d" />
          </svg>
        </div>
        <div className="lp-glass lp-float-2 rounded-2xl p-4 lg:absolute lg:-end-8 lg:-top-6 lg:w-60" data-testid="glass-value">
          <div className="flex items-center gap-2 text-xs font-medium text-mute"><Gem className="h-4 w-4 text-s7" aria-hidden />{d.value}</div>
          <div className="mt-1 text-2xl font-semibold num">{money(f.value.fair, cur, true)}</div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-band" aria-hidden><div className="h-full rounded-full bg-gradient-to-r from-brand via-s1 to-s7" style={{ width: `${Math.min(100, (f.value.fair / f.value.highest) * 100)}%` }} /></div>
          <div className="mt-1 text-xs text-mute">{d.valueRange(money(f.value.low, cur, true), money(f.value.high, cur, true))}</div>
        </div>
        <div className="lp-glass lp-float rounded-2xl p-4 lg:absolute lg:-end-12 lg:top-1/2 lg:w-52" data-testid="glass-cash">
          <div className="flex items-center gap-2 text-xs font-medium text-mute"><Banknote className="h-4 w-4 text-green-d" aria-hidden />{d.cash}</div>
          <div className="mt-1 text-2xl font-semibold num">{money(f.cash, cur, true)}</div>
        </div>
        <div className="lp-glass lp-float-2 flex items-center gap-3 rounded-2xl p-4 lg:absolute lg:bottom-0 lg:end-6 lg:w-64" data-testid="glass-doctor">
          <Ring share={f.doctor.score / 100} label={String(f.doctor.score)} color="#2e9e6a" />
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-mute"><Stethoscope className="h-4 w-4 text-brand-d" aria-hidden />{d.doctor}</div>
            <div className="mt-1 text-sm">{d.doctorFound(f.doctor.findings, money(f.doctor.atStake, cur, true))}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

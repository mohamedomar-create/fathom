import { BarChart3, Banknote, CheckCircle2, Gem, LayoutDashboard, LineChart, Receipt, Sparkles, Stethoscope, TrendingUp, Wallet } from "lucide-react";
import { money, pct } from "@/lib/engine/format";
import type { LandingFigures } from "@/lib/landing/figures";

export type DashCopy = {
  title: string; period: string; revenue: string; profit: string; cash: string; worth: string; chart: string; costs: string;
  mix: string; cos: string; expenses: string; ebit: string; ai: string; aiText: (n: number, at: string) => string; score: string;
  balanced: string; vsLast: (p: string) => string; readBy: string; months: string[];
};

/** Points of a series scaled into a box; lo/hi shared when two series are drawn together. */
function scale(values: number[], w: number, h: number, lo: number, hi: number, pad = 8) {
  const span = hi - lo || 1;
  return values.map((v, i) => [pad + (i * (w - 2 * pad)) / Math.max(1, values.length - 1), pad + (1 - (v - lo) / span) * (h - 2 * pad)] as const);
}
/** A smooth line through the points (Catmull-Rom as cubic Béziers). */
function smooth(pts: readonly (readonly [number, number])[]) {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}
function Spark({ values, color }: { values: number[]; color: string }) {
  const lo = Math.min(...values), hi = Math.max(...values);
  const d = smooth(scale(values, 96, 28, lo, hi, 3));
  return <svg viewBox="0 0 96 28" className="h-7 w-full" preserveAspectRatio="none" aria-hidden><path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>;
}

/**
 * The hero's living dashboard: drawn, not a screenshot, so it is sharp at any size. Every figure is the demo company's
 * own, computed by the same engine as the product (revenue, profit, cash, worth, the cost structure, the books health).
 */
export function LiveDashboard({ f, c }: { f: LandingFigures; c: DashCopy }) {
  const cur = f.currency;
  const W = 560, H = 190;
  const lo = Math.min(...f.series.costs, ...f.series.revenue) * 0.9, hi = Math.max(...f.series.revenue, ...f.series.costs) * 1.04;
  const rev = scale(f.series.revenue, W, H, lo, hi), cost = scale(f.series.costs, W, H, lo, hi);
  const revD = smooth(rev), costD = smooth(cost);
  const area = `${revD} L${rev.at(-1)![0]},${H} L${rev[0][0]},${H} Z`;
  const mixTotal = Math.max(1, f.mix.cos + f.mix.expenses + Math.max(0, f.mix.ebit));
  const parts = [
    { k: c.cos, v: f.mix.cos, color: "#0f8b8d" },
    { k: c.expenses, v: f.mix.expenses, color: "#2a78d6" },
    { k: c.ebit, v: Math.max(0, f.mix.ebit), color: "#6250d6" },
  ];
  const R = 36, C = 2 * Math.PI * R;
  let acc = 0;
  const monthOf = (p: string) => c.months[Number(p.slice(5, 7)) - 1] ?? p;
  const tiles = [
    { id: "glass-revenue", k: c.revenue, v: money(f.revenue, cur, true), s: f.series.revenue, color: "#0f8b8d", icon: TrendingUp, delta: null },
    { id: "glass-profit", k: c.profit, v: money(f.netProfit, cur, true), s: f.series.ebit, color: "#6250d6", icon: BarChart3, delta: null },
    { id: "glass-cash", k: c.cash, v: money(f.cash, cur, true), s: f.series.cash, color: "#2e9e6a", icon: Wallet, delta: null },
    // Worth has no monthly history: its tile shows where the fair value sits in its range instead of a line.
    { id: "glass-value", k: c.worth, v: money(f.value.fair, cur, true), s: null, color: "#2a78d6", icon: Gem, delta: null },
  ];
  return (
    <div className="relative" data-testid="live-dashboard">
      <div className="lp-glass overflow-hidden rounded-3xl">
        <div className="flex items-center gap-3 border-b border-line/70 bg-white/60 px-4 py-2.5">
          <span className="flex gap-1.5" aria-hidden><i className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" /><i className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" /><i className="h-2.5 w-2.5 rounded-full bg-[#28c840]" /></span>
          <span className="truncate text-xs font-medium text-ink-2">{f.company} · {c.title}</span>
          <span className="ms-auto flex items-center gap-1.5 rounded-full bg-green-bg px-2 py-0.5 text-[11px] font-medium text-green-d"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green" aria-hidden />{c.period}</span>
        </div>
        <div className="flex">
          <nav className="hidden w-12 shrink-0 flex-col items-center gap-3 border-e border-line/70 bg-white/40 py-4 text-mute sm:flex" aria-hidden>
            {[LayoutDashboard, LineChart, Receipt, Banknote, Stethoscope].map((I, i) => <span key={i} className={i === 0 ? "rounded-lg bg-brand-bg p-1.5 text-brand-d" : "p-1.5"}><I className="h-4 w-4" /></span>)}
          </nav>
          <div className="min-w-0 flex-1 p-4">
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              {tiles.map((t, i) => (
                <div key={t.k} className="lp-rise rounded-xl border border-line/70 bg-white/80 p-3" style={{ animationDelay: `${0.1 + i * 0.08}s` }} data-testid={t.id}>
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-mute"><t.icon className="h-3.5 w-3.5" style={{ color: t.color }} aria-hidden />{t.k}</div>
                  <div className="mt-1 truncate text-lg font-semibold tracking-tight num">{t.v}</div>
                  {t.s ? <Spark values={t.s} color={t.color} /> : (
                    <div className="flex h-7 items-center" aria-hidden><div className="relative h-1.5 w-full rounded-full bg-gradient-to-r from-brand-bg via-[#cfe0f6] to-[#ddd8f6]"><span className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-white bg-s1 shadow" style={{ insetInlineStart: `calc(${Math.min(94, ((f.value.fair - f.value.low) / Math.max(1, f.value.high - f.value.low)) * 100)}% - 6px)` }} /></div></div>
                  )}
                  {t.delta !== null && <div className={`text-[11px] font-medium ${t.delta >= 0 ? "text-green-d" : "text-red"}`}>{t.delta >= 0 ? "▲" : "▼"} {c.vsLast(pct(Math.abs(t.delta), 1))}</div>}
                </div>
              ))}
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-[1.6fr_1fr]">
              <div className="rounded-xl border border-line/70 bg-white/80 p-3">
                <div className="flex items-center justify-between text-xs"><span className="font-medium text-ink-2">{c.chart}</span>
                  <span className="flex gap-3 text-mute"><span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-brand" />{c.revenue}</span><span className="flex items-center gap-1"><i className="h-0.5 w-3 bg-[#eb6834]" />{c.costs}</span></span></div>
                <svg viewBox={`0 0 ${W} ${H + 18}`} className="mt-2 h-44 w-full" preserveAspectRatio="none" aria-hidden>
                  <defs><linearGradient id="lp-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#0f8b8d" stopOpacity=".32" /><stop offset="1" stopColor="#0f8b8d" stopOpacity="0" /></linearGradient></defs>
                  {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2={W} y1={H * g} y2={H * g} stroke="#e8ebea" strokeWidth="1" />)}
                  <path d={area} fill="url(#lp-area)" />
                  <path d={costD} fill="none" stroke="#eb6834" strokeWidth="2" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />
                  <path d={revD} fill="none" stroke="#0f8b8d" strokeWidth="3" className="lp-draw" vectorEffect="non-scaling-stroke" />
                  <circle cx={rev.at(-1)![0]} cy={rev.at(-1)![1]} r="6" fill="#fff" stroke="#0f8b8d" strokeWidth="3" />
                  {f.series.periods.map((p, i) => i % 2 === 1 ? <text key={p} x={rev[i][0]} y={H + 14} textAnchor={i === f.series.periods.length - 1 ? "end" : "middle"} fontSize="11" fill="#77766f">{monthOf(p)}</text> : null)}
                </svg>
              </div>
              <div className="grid gap-3">
                <div className="flex items-center gap-3 rounded-xl border border-line/70 bg-white/80 p-3">
                  <svg viewBox="0 0 90 90" className="h-20 w-20 shrink-0 -rotate-90" aria-hidden>
                    {parts.map((p) => { const len = (p.v / mixTotal) * C; const el = <circle key={p.k} cx="45" cy="45" r={R} fill="none" stroke={p.color} strokeWidth="12" strokeDasharray={`${Math.max(0, len - 2)} ${C}`} strokeDashoffset={-acc} />; acc += len; return el; })}
                  </svg>
                  <div className="min-w-0 text-[11px]">
                    <div className="mb-1 font-medium text-ink-2">{c.mix}</div>
                    {parts.map((p) => <div key={p.k} className="flex items-center gap-1.5 text-mute"><i className="h-2 w-2 shrink-0 rounded-sm" style={{ background: p.color }} /><span className="truncate">{p.k}</span><b className="ms-auto ps-2 font-medium text-ink num">{Math.round((p.v / mixTotal) * 100)}%</b></div>)}
                  </div>
                </div>
                <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-[#0b6e70] to-[#1d56a6] p-3 text-white" data-testid="glass-doctor">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-white/90"><Sparkles className="h-3.5 w-3.5" aria-hidden />{c.ai}</div>
                  <div className="mt-1 flex items-end gap-2"><span className="text-2xl font-semibold num">{f.doctor.score}</span><span className="pb-1 text-[11px] text-white/85">/100 · {c.score}</span></div>
                  <p className="mt-1 text-[11.5px] leading-snug text-white/90">{c.aiText(f.doctor.findings, money(f.doctor.atStake, cur, true))}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="lp-float lp-glass absolute -start-4 -top-5 hidden items-center gap-2 rounded-2xl px-3 py-2 text-xs font-medium sm:flex" data-testid="chip-balanced"><CheckCircle2 className="h-4 w-4 text-green" aria-hidden />{c.balanced}</div>
      <div className="lp-float-2 lp-glass absolute -bottom-5 -end-3 hidden items-center gap-2 rounded-2xl px-3 py-2 text-xs font-medium sm:flex"><Sparkles className="h-4 w-4 text-s7" aria-hidden />{c.readBy}</div>
    </div>
  );
}

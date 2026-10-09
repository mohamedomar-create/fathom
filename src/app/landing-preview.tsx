"use client";
import { useMemo } from "react";
import { analyze, money, mshort, pct, type MonthData } from "@/lib/engine";
import sample from "../../reference/sample.json";
import { LineChart } from "@/components/charts/line-chart";
import { CashWaterfall } from "@/components/charts/waterfall";
import { TipProvider } from "@/components/ui/tooltip";

export function LandingPreview() {
  const a = useMemo(() => analyze(sample.months as MonthData[], { type: "month", end: "2026-09" }, { currency: "EGP", fyStartMonth: 1, taxRate: 0.225, targets: sample.targets }), []);
  const s = a.view.series;
  return (
    <TipProvider>
    <div className="fade-up rounded-xl border border-line bg-white p-5 shadow-xl">
      <div className="mb-3 flex items-center justify-between">
        <div><div className="label">Sample Trading Co · Sep 2026</div><div className="text-2xl font-light">{money(a.view.P.revenue, "EGP")} <span className="text-sm text-mute">revenue</span></div></div>
        <div className="text-right"><div className="text-3xl font-light text-green-d">{Math.round((a.onTrack / (a.onTrack + a.offTrack)) * 100)}%</div><div className="text-[10px] uppercase tracking-wider text-mute">KPIs on track</div></div>
      </div>
      <LineChart labels={s.periods.map(mshort)} cur="EGP" height={170} series={[{ name: "Revenue", values: s.P.map((p) => p.revenue), color: "#2a78d6" }, { name: "EBIT", values: s.P.map((p) => p.ebit), color: "#eb6834" }]} />
      <div className="mt-3 grid grid-cols-3 gap-3 border-t border-line pt-3 text-sm">
        <div><div className="label">Gross margin</div>{pct(a.K.gpm, 1)}</div>
        <div><div className="label">Breakeven cushion</div>{a.breakeven.ok ? pct(a.breakeven.mosPct, 0) : "–"}</div>
        <div><div className="label">Operating cash flow</div>{money(a.W?.ocf ?? 0, "EGP", true)}</div>
      </div>
      <div className="mt-4 hidden max-h-56 overflow-hidden sm:block [mask-image:linear-gradient(to_bottom,black_70%,transparent)]">
        {a.W && <CashWaterfall rows={a.W.rows.slice(0, 12)} cur="EGP" />}
      </div>
    </div>
    </TipProvider>
  );
}

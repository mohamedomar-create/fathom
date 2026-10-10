"use client";
import { money, mshort, pct } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { useComments, useAnalysis, usePeriod } from "@/lib/company/use-period";
import { PageHeader } from "@/components/shell/page-header";
import { PeriodPicker } from "@/components/shell/period-picker";
import { Sparkline } from "@/components/charts/spark";
import { LineChart } from "@/components/charts/line-chart";
import { cn } from "@/lib/cn";
import { Delta } from "@/components/ui/status";
import type { Finding } from "@/lib/engine";
import { useState } from "react";
import { SourceDrawer, type SourceLine } from "./source-drawer";

export function SummaryPage({ commentarySlot }: { commentarySlot?: React.ReactNode }) {
  const c = useCompany();
  const a = useAnalysis();
  const comments = useComments();
  const { sel } = usePeriod();
  const [src, setSrc] = useState<SourceLine | null>(null);
  if (!a) return null;
  const cur = c.settings.currency;
  const { P, B, B0, prior, series } = a.view;
  const score = a.onTrack + a.offTrack ? (a.onTrack / (a.onTrack + a.offTrack)) * 100 : 0;
  const last12 = (n: number) => Math.max(0, series.P.length - n);
  const sp = { P: series.P.slice(last12(12)), B: series.B.slice(last12(12)) };
  const gpm = a.K.gpm, tg = a.targets.gpm ?? 35;
  const ch = (x: number, y: number | null | undefined) => (y ? ((x - y) / Math.abs(y)) * 100 : null);
  const prevLabel = prior?.label ?? "";
  const hero = [
    { l: "Revenue", trace: ["revenue", "PL"] as const, v: money(P.revenue, cur), d: <><Delta value={ch(P.revenue, prior?.P.revenue)} /> <span className="text-mute">vs {prevLabel}</span></>, neg: P.revenue < 0, s: sp.P.map((p) => p.revenue) },
    { l: "Gross margin", v: gpm === null ? "–" : pct(gpm, 1), d: <span className="text-mute">target {pct(tg, 0)}</span>, neg: gpm !== null && gpm < tg, s: sp.P.map((p) => (p.revenue ? (p.gross_profit / p.revenue) * 100 : null)) },
    { l: "EBIT", trace: ["ebit", "PL"] as const, v: money(P.ebit, cur), d: <><Delta value={ch(P.ebit, prior?.P.ebit)} /> <span className="text-mute">vs {prevLabel}</span></>, neg: P.ebit < 0, s: sp.P.map((p) => p.ebit) },
    { l: "Cash on hand", trace: ["cash", "BS"] as const, v: money(B.cash, cur), d: B0 ? <><Delta value={ch(B.cash, B0.cash)} /> <span className="text-mute">vs opening</span></> : <span className="text-mute">no opening balance</span>, neg: B.cash < 0, s: sp.B.map((b) => b.cash) },
    { l: "Operating cash flow", v: a.W ? money(a.W.ocf, cur) : "–", d: a.W ? <span className="text-mute">{P.ebit ? `${Math.round((a.W.ocf / P.ebit) * 100)}% of EBIT` : ""}</span> : null, neg: (a.W?.ocf ?? 0) < 0, s: [] },
    { l: "Breakeven cushion", v: a.breakeven.ok ? pct(a.breakeven.mosPct, 0) : "–", d: a.breakeven.ok ? <span className="text-mute">breakeven {money(a.breakeven.bep, cur, true)}</span> : null, neg: a.breakeven.ok && a.breakeven.mosPct < 0, s: [] },
  ];
  const headline = comments("summary") ||
    `${c.name} ${P.ebit >= 0 ? "made" : "lost"} ${money(Math.abs(P.ebit), cur)} at EBIT on revenue of ${money(P.revenue, cur)} in ${a.view.window.label}; ${a.onTrack} of ${a.onTrack + a.offTrack} measurable KPIs are on target and cash stands at ${money(B.cash, cur)}.`;
  const labels = series.periods.slice(-12).map(mshort);
  return (
    <>
      <PageHeader title="Executive Summary" right={<PeriodPicker />} />
      <div className="fade-up mb-6 flex flex-wrap items-center gap-6 bg-band px-5 py-4">
        <div className={cn("text-[52px] font-light leading-none", score >= 60 ? "text-green-d" : "text-red")} data-testid="score">{Math.round(score)}%</div>
        <div>
          <b className="font-semibold">KPIs on track</b>
          <div className="text-mute">{a.onTrack} on track · {a.offTrack} off track · {a.kpiRows.length - a.onTrack - a.offTrack} not measurable</div>
        </div>
      </div>
      <p className="fade-up mb-6 max-w-4xl text-[17px] leading-relaxed whitespace-pre-line" data-testid="headline">{headline}</p>
      {commentarySlot}
      <div className="mb-8 grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-3 xl:grid-cols-6">
        {hero.map((h) => (
          <div key={h.l} className={cn("fade-up border-t-[3px] pt-2.5", h.neg ? "border-red" : "border-green")}>
            <div className="label">{h.l}</div>
            <div className="num my-0.5 whitespace-nowrap text-[21px]">
              {"trace" in h && h.trace ? (
                <button type="button" onClick={() => setSrc({ key: h.trace[0], label: h.l, statement: h.trace[1], periods: a.view.window.periods })} className="decoration-dotted underline-offset-4 hover:underline" title="Show the accounts and source file behind this figure" data-testid={`trace-${h.trace[0]}`}>{h.v}</button>
              ) : h.v}
            </div>
            <div className="text-xs">{h.d}</div>
            {h.s.length > 1 && <div className="mt-1"><Sparkline values={h.s} color={h.neg ? "#D9343A" : "#7CB46B"} w={130} h={30} /></div>}
          </div>
        ))}
      </div>
      <div className="grid gap-10 lg:grid-cols-2">
        <div>
          <FindingList title="Needs attention" kind="risk" findings={a.findings} />
          <FindingList title="Watch" kind="watch" findings={a.findings} />
        </div>
        <div>
          <FindingList title="Going well" kind="win" findings={a.findings} />
          <h3 className="mb-1 mt-6 text-lg font-normal">Revenue &amp; EBIT, last 12 months</h3>
          <LineChart labels={labels} cur={cur} height={240}
            series={[
              { name: "Revenue", values: series.P.slice(-12).map((p) => p.revenue), color: "#2a78d6" },
              { name: "EBIT", values: series.P.slice(-12).map((p) => p.ebit), color: "#eb6834" },
            ]} />
        </div>
      </div>
      <SourceDrawer line={src} onClose={() => setSrc(null)} />
      {sel.type !== "month" && !a.view.complete && <p className="mt-6 text-xs text-mute">Some months in this period are not loaded; totals cover the months available.</p>}
    </>
  );
}

function FindingList({ title, kind, findings }: { title: string; kind: Finding["kind"]; findings: Finding[] }) {
  const list = findings.filter((f) => f.kind === kind).slice(0, 4);
  return (
    <div className="mb-6" data-testid={`findings-${kind}`}>
      <h3 className="mb-1 text-lg font-normal">{title}</h3>
      {list.length ? list.map((f) => (
        <div key={f.title} className="grid grid-cols-[14px_1fr] gap-2.5 border-b border-line py-2.5">
          <span className={cn("mt-1.5 h-2.5 w-2.5 rounded-full", kind === "risk" ? "bg-red" : kind === "watch" ? "bg-amber" : "bg-green")} />
          <div><b className="font-semibold">{f.title}</b><div className="text-[12.5px] text-mute">{f.text}</div></div>
        </div>
      )) : <div className="py-2.5 text-mute">Nothing to flag.</div>}
    </div>
  );
}

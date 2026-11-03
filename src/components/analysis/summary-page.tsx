"use client";
import { money, pct } from "@/lib/engine";
import { compact } from "@/lib/engine/format";
import { useCompany } from "@/lib/company/context";
import { useComments, useAnalysis, usePeriod } from "@/lib/company/use-period";
import { PageHeader } from "@/components/shell/page-header";
import { PeriodPicker } from "@/components/shell/period-picker";
import { LineChart } from "@/components/charts/line-chart";
import { cn } from "@/lib/cn";
import type { Finding } from "@/lib/engine";
import { useState } from "react";
import { SourceDrawer, type SourceLine } from "./source-drawer";
import { ReadinessCard } from "@/components/setup/readiness-view";
import { useT } from "@/lib/i18n/use-t";
import { Cockpit, HeroKpi, KpiTile } from "@/components/viz/kpi";
import { CardGrid, ChartCard } from "@/components/viz/chart-card";
import { Bridge } from "@/components/viz/bridge";
import { Bullet } from "@/components/viz/bullet";
import { HeatCalendar } from "@/components/viz/heat-calendar";
import { GHOST, SERIES } from "@/components/viz/palette";
import { sameMonthLastYear } from "@/lib/viz/geometry";

const RANK: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

export function SummaryPage({ commentarySlot }: { commentarySlot?: React.ReactNode }) {
  const c = useCompany();
  const a = useAnalysis();
  const comments = useComments();
  const { sel } = usePeriod();
  const [src, setSrc] = useState<SourceLine | null>(null);
  const T = useT();
  const t = T.d.ana;
  const v = T.d.viz.fin;
  if (!a) return null;
  const cur = c.settings.currency;
  const lang = T.lang === "ar" ? "ar" : "en";
  const { P, B, B0, prior, series } = a.view;
  const n = series.P.length;
  const win = (k: number, from: number) => series.P.slice(Math.max(0, n - from), Math.max(0, n - from + k));
  const now12 = win(12, 12);
  // Last year's same months, under the months they compare with (null where that month isn't held).
  const last12 = sameMonthLastYear(series.periods, series.P, series.periods.slice(-12));
  const B12 = series.B.slice(Math.max(0, n - 12));
  const gpm = a.K.gpm, tg = a.targets.gpm ?? 35;
  const ch = (x: number, y: number | null | undefined) => (y ? ((x - y) / Math.abs(y)) * 100 : null);
  const margin = (p: { revenue: number; gross_profit: number }) => (p.revenue ? (p.gross_profit / p.revenue) * 100 : null);
  const prevLabel = T.pl(prior?.label ?? "");
  const hasBS = c.months.some((m) => m.has?.bs ?? true);
  const measured = a.onTrack + a.offTrack;
  const score = measured ? (a.onTrack / measured) * 100 : 0;
  const headline = comments("summary") ||
    t.headline(c.name, P.ebit >= 0, money(Math.abs(P.ebit), cur), money(P.revenue, cur), T.pl(a.view.window.label), a.onTrack, measured, hasBS ? money(B.cash, cur) : null);
  const trace = (key: string, label: string, statement: "PL" | "BS", node: React.ReactNode) => (
    <button type="button" onClick={() => setSrc({ key, label, statement, periods: a.view.window.periods })} className="decoration-dotted underline-offset-4 hover:underline" title={t.traceTitle} data-testid={`trace-${key}`}>{node}</button>
  );
  const m12 = series.periods.slice(-12);
  const labels = m12.map(T.ms);
  const lyRev = last12.map((p) => p?.revenue ?? null);
  const bridge = [
    { label: t.revenue, value: P.revenue, total: true },
    { label: v.costOfSales, value: P.gross_profit - P.revenue },
    { label: v.grossProfit, value: P.gross_profit, total: true },
    { label: v.opex, value: P.operating_profit - P.gross_profit },
    { label: v.opProfit, value: P.operating_profit, total: true },
    ...(Math.abs(P.ebit - P.operating_profit) >= 0.5 ? [{ label: v.otherItems, value: P.ebit - P.operating_profit }] : []),
    { label: v.interestTax, value: P.net_income - P.ebit },
    { label: v.netProfit, value: P.net_income, total: true },
  ];
  const bullets = a.kpiRows
    .filter((r) => r.value !== null && a.targets[r.def.key] !== null && a.targets[r.def.key] !== undefined)
    .sort((x, y) => RANK[x.importance] - RANK[y.importance])
    .slice(0, 7);
  return (
    <>
      <PageHeader title={T.d.nav.summary[1]} right={<PeriodPicker />} />
      <ReadinessCard sector="financials" />
      <Cockpit hero={
        <HeroKpi label={v.netProfit} testId="hero-net" value={trace("net_income", v.netProfit, "PL", money(P.net_income, cur, true))} neg={P.net_income < 0}
          delta={ch(P.net_income, prior?.P.net_income)} deltaLabel={`${t.vs(prevLabel)} · ${v.margin(P.revenue ? pct((P.net_income / P.revenue) * 100, 1) : "–")}`}
          now={now12.map((p) => p.net_income)} last={last12.map((p) => p?.net_income ?? null)}
          story={<span className="whitespace-pre-line" data-testid="headline">{headline}</span>} />
      }>
        <KpiTile label={t.revenue} value={trace("revenue", t.revenue, "PL", money(P.revenue, cur, true))} delta={ch(P.revenue, prior?.P.revenue)} sub={t.vs(prevLabel)}
          now={now12.map((p) => p.revenue)} last={last12.map((p) => p?.revenue ?? null)} neg={P.revenue < 0} />
        <KpiTile label={t.grossMargin} value={gpm === null ? "–" : pct(gpm, 1)} neg={gpm !== null && gpm < tg} pp
          delta={gpm !== null && prior ? (() => { const pm = margin(prior.P); return pm === null ? null : gpm - pm; })() : undefined}
          sub={t.target(pct(tg, 0))} now={now12.map(margin)} />
        <KpiTile label={t.ebit} value={trace("ebit", t.ebit, "PL", money(P.ebit, cur, true))} delta={ch(P.ebit, prior?.P.ebit)} neg={P.ebit < 0} now={now12.map((p) => p.ebit)} />
        <KpiTile label={t.cashOnHand} value={hasBS ? trace("cash", t.cashOnHand, "BS", money(B.cash, cur, true)) : "–"} neg={B.cash < 0}
          delta={hasBS && B0 ? ch(B.cash, B0.cash) : undefined} sub={!hasBS ? t.needsBS : B0 ? t.vsOpening : t.noOpening} now={hasBS ? B12.map((b) => b.cash) : undefined} />
        <KpiTile label={v.kpiScore} testId="kpi-score" value={<span className={score >= 60 ? "text-green-d" : "text-red"} data-testid="score">{Math.round(score)}%</span>}
          sub={t.trackLine(a.onTrack, a.offTrack, a.kpiRows.length - measured)}>
          <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-band" aria-hidden>
            <div className="bg-green" style={{ width: `${measured ? (a.onTrack / a.kpiRows.length) * 100 : 0}%` }} />
            <div className="ms-[2px] bg-red" style={{ width: `${measured ? (a.offTrack / a.kpiRows.length) * 100 : 0}%` }} />
          </div>
        </KpiTile>
        <KpiTile label={t.cushion} value={a.breakeven.ok ? pct(a.breakeven.mosPct, 0) : "–"} neg={a.breakeven.ok && a.breakeven.mosPct < 0}
          sub={a.breakeven.ok ? t.breakevenAt(money(a.breakeven.bep, cur, true)) : undefined} />
      </Cockpit>
      {commentarySlot}
      <CardGrid>
        <ChartCard title={t.revEbit12} wide testId="card-rev-ebit"
          table={{ head: [T.d.viz.month, t.revenue, t.ebit, v.revLastYear], rows: m12.map((p, i) => [T.ml(p), money(now12[i]?.revenue, cur), money(now12[i]?.ebit, cur), money(lyRev[i], cur)]) }}>
          <LineChart labels={labels} cur={cur} height={260}
            series={[
              { name: t.revenue, values: now12.map((p) => p.revenue), color: SERIES[0], fill: true },
              { name: t.ebit, values: now12.map((p) => p.ebit), color: SERIES[1] },
              ...(lyRev.some((x) => x !== null) ? [{ name: v.revLastYear, values: lyRev, color: GHOST, dashed: true, dots: false }] : []),
            ]} />
        </ChartCard>
        <ChartCard title={v.profitBridge} sub={v.profitBridgeSub} testId="card-profit-bridge"
          table={{ head: [T.d.viz.item, T.d.viz.value], rows: bridge.map((b) => [b.label, money(b.value, cur)]) }}>
          <Bridge rows={bridge} cur={cur} height={280} testId="profit-bridge" />
        </ChartCard>
        <ChartCard title={v.kpiTargets} sub={v.kpiTargetsSub} testId="card-kpi-bullets">
          {bullets.length ? bullets.map((r) => (
            <Bullet key={r.def.key} label={T.kn(r.def)} value={r.value} target={a.targets[r.def.key]} lowerIsBetter={r.def.direction === "down"}
              fmt={(x) => T.num(x, r.def.unit, cur)} testId={`bullet-${r.def.key}`} />
          )) : <p className="text-sm text-mute">{t.nothing}</p>}
        </ChartCard>
        <ChartCard title={v.seasonality} sub={v.seasonalitySub} wide testId="card-season">
          <HeatCalendar periods={series.periods} values={series.P.map((p) => p.revenue)} fmt={(x) => compact(x, lang)} testId="season-heat" />
        </ChartCard>
        <ChartCard title={v.findings} wide testId="card-findings">
          <div className="grid gap-6 md:grid-cols-3">
            <FindingList title={t.risk} kind="risk" findings={a.findings} />
            <FindingList title={t.watch} kind="watch" findings={a.findings} />
            <FindingList title={t.win} kind="win" findings={a.findings} />
          </div>
        </ChartCard>
      </CardGrid>
      <SourceDrawer line={src} onClose={() => setSrc(null)} />
      {sel.type !== "month" && !a.view.complete && <p className="mt-6 text-xs text-mute">{t.someMissing}</p>}
    </>
  );
}

function FindingList({ title, kind, findings }: { title: string; kind: Finding["kind"]; findings: Finding[] }) {
  const t = useT().d.ana;
  const list = findings.filter((f) => f.kind === kind).slice(0, 4);
  const dot = kind === "risk" ? "bg-red" : kind === "watch" ? "bg-amber" : "bg-green";
  return (
    <div data-testid={`findings-${kind}`}>
      <h4 className="mb-1 flex items-center gap-2 text-[13px] font-semibold"><span className={cn("h-2.5 w-2.5 rounded-full", dot)} aria-hidden />{title}<span className="text-mute">({findings.filter((f) => f.kind === kind).length})</span></h4>
      {list.length ? list.map((f) => (
        <div key={f.title} className="border-b border-line py-2 last:border-0">
          <b className="text-[13px] font-semibold">{f.title}</b><div className="text-[12.5px] text-mute">{f.text}</div>
        </div>
      )) : <div className="py-2 text-[13px] text-mute">{t.nothing}</div>}
    </div>
  );
}

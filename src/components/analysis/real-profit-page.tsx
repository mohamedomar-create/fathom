"use client";
import { useMemo } from "react";
import { money, pct, realProfit, realProfitSummary, receivablesLine, twelveMonths, type WaterfallRow } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { usePeriod } from "@/lib/company/use-period";
import { PageHeader } from "@/components/shell/page-header";
import { PeriodPicker } from "@/components/shell/period-picker";
import { AssumptionsPanel, useAssumptions } from "./assumptions";
import { Cockpit, HeroKpi, KpiTile } from "@/components/viz/kpi";
import { CardGrid, ChartCard } from "@/components/viz/chart-card";
import { Bridge } from "@/components/viz/bridge";
import { Bullet } from "@/components/viz/bullet";
import { MemoBox } from "./memo-box";
import { useT } from "@/lib/i18n/use-t";

const usd = (v: number | null) => (v === null ? "–" : money(v, "USD"));
/** A sentence as [text, bold, text, bold, text…]: odd parts are figures shown in bold. */
const bold = (parts: string[]) => parts.map((p, i) => (i % 2 ? <b key={i}>{p}</b> : p));

export function RealProfitPage() {
  const c = useCompany();
  const { sel } = usePeriod();
  const cur = c.settings.currency;
  const { a, setA, saved } = useAssumptions();
  const { lang, d: { rp: t, viz: T_viz }, pl } = useT();
  const T_fin = T_viz.fin;
  const target = c.settings.targets?.ar_days ?? 45;
  const basis = useMemo(() => (sel.end ? twelveMonths(c.months, sel.end, c.settings.fyStartMonth, c.asOf, c.settings.vatRate, c.settings.vatSalesRate) : null), [c.months, sel.end, c.settings.fyStartMonth, c.asOf, c.settings.vatRate, c.settings.vatSalesRate]);
  const x = useMemo(() => (basis ? realProfit(basis, a, cur, target ?? 45, lang) : null), [basis, a, cur, target, lang]);
  if (!basis || !x) return null;
  const m = (v: number | null) => (v === null ? "–" : money(v, cur));
  const col = x.collection;
  const inf = x.inflation;
  const rows: WaterfallRow[] = inf ? [
    { label: t.reported, sign: "TOTAL", value: x.reported },
    ...inf.steps.map((s): WaterfallRow => ({ label: s.label, sign: s.value >= 0 ? "ADD" : "LESS", value: s.value, info: s.explain })),
    { label: t.realAtToday, sign: "TOTAL", value: inf.real },
  ] : [];
  return (
    <>
      <PageHeader title={t.title} right={<PeriodPicker />}>
        <p className="text-sm text-mute" data-testid="real-basis">{t.basis[0]}<b className="text-ink">{pl(basis.label)}</b>{t.basis[1]}</p>
      </PageHeader>

      <Cockpit hero={
        <HeroKpi label={inf ? t.real : t.reported} testId="hero-real" value={money(inf ? inf.real : x.reported, cur, true)} neg={(inf ? inf.real : x.reported) < 0}
          delta={inf && x.reported ? ((inf.real - x.reported) / Math.abs(x.reported)) * 100 : undefined}
          deltaLabel={inf ? `${t.reported}: ${money(x.reported, cur, true)} · ${t.afterInf(pct(inf.periodRate, 1))}` : t.asBooks} />
      }>
        <KpiTile label={t.reported} value={money(x.reported, cur, true)} neg={x.reported < 0} sub={t.asBooks} testId="tile-reported" />
        <KpiTile label={t.cashOps} value={x.cashProfit === null ? "–" : money(x.cashProfit, cur, true)} neg={(x.cashProfit ?? 0) < 0} sub={x.cashProfit === null ? t.needsBefore : t.ocfSub} />
        <KpiTile label={t.real} value={inf ? money(inf.real, cur, true) : "–"} neg={!!inf && inf.real < 0} sub={inf ? t.afterInf(pct(inf.periodRate, 1)) : t.enterInf} testId="tile-real" />
        <KpiTile label={t.usd} value={x.fx ? usd(x.fx.reportedUsd) : "–"} neg={!!x.fx && x.fx.reportedUsd < 0} sub={x.fx ? t.pound(x.fx.devaluation >= 0, pct(Math.abs(x.fx.poundChange), 1)) : t.enterFx} />
      </Cockpit>

      <div className="mb-8"><MemoBox section="realprofit" title={t.memoTitle} fallback={realProfitSummary(x, cur, lang)} testId="real-memo" /></div>

      <div className="mb-10">
        <AssumptionsPanel fields={["inflation", "fxStart", "fxEnd", "importShare", "assetAge", "rate"]} a={a} setA={setA} saved={saved} />
      </div>

      <CardGrid>
        <ChartCard title={t.h1} sub={t.h1Text} testId="collection">
          <Bullet label={t.rate} value={col.rate} target={null} fmt={(v) => pct(v, 1)} testId="bullet-collect-rate" />
          <Bullet label={t.dso} value={col.dso} target={target} lowerIsBetter fmt={(v) => t.days(Math.round(v))} testId="bullet-dso" />
          <table className="tbl mt-3 text-[13px]"><tbody>
            <tr className="row"><td>{t.invoiced}</td><td>{m(col.revenue)}</td></tr>
            {(() => { const r = receivablesLine(col.stuck); return <tr className="row"><td>{r?.dir === "add" ? t.owedDown : t.owedUp}</td><td>{r === null ? t.needsBefore : m(r.value)}</td></tr>; })()}
            <tr className="tot"><td>{t.collected}</td><td>{m(col.collected)}</td></tr>
          </tbody></table>
        </ChartCard>
        <ChartCard title={T_fin.collection} testId="collection-cost">
          <div className="space-y-3 text-[13px]">
            {col.dso !== null && <p>{bold(t.takes(Math.round(col.dso), m(col.avgAR)))}</p>}
            {col.creditCost !== null ? (
              <>
                <p>{bold(t.credit(pct(a.rate ?? 0, 1), m(col.creditCost), m(col.perDay)))}</p>
                {col.release !== null && <p className="rounded-lg bg-brand-bg px-3 py-2">{bold(t.release(Math.round(col.targetDso), m(col.release), m(col.saving)))}</p>}
              </>
            ) : <p className="text-mute">{t.enterRate}</p>}
          </div>
        </ChartCard>
      </CardGrid>

      <h2 className="mb-1 text-lg font-semibold">{t.h2}</h2>
      <p className="mb-4 text-sm text-mute">{t.h2Text}</p>
      {inf ? (
        <div className="mb-10">
          <ChartCard title={T_fin.realBridge} testId="card-real-bridge"
            table={{ head: [T_viz.item, T_viz.value], rows: rows.map((r) => [r.label, m(r.value)]) }}>
            <div data-testid="real-bridge"><Bridge rows={rows.map((r) => ({ label: r.label, value: r.value, total: r.sign === "TOTAL", info: r.info }))} cur={cur} height={300} /></div>
          </ChartCard>
          <div className="mt-6 grid gap-4 text-[13px] sm:grid-cols-3">
            <div className="rounded-xl border border-line p-4"><div className="label">{t.roe}</div><div className="t-kpi mt-1">{inf.roe === null ? "–" : pct(inf.roe, 1)}</div><div className="text-mute">{t.roeSub}</div></div>
            <div className="rounded-xl border border-line p-4"><div className="label">{t.afterInfl}</div><div className={`t-kpi mt-1 ${inf.realRoe !== null && inf.realRoe < 0 ? "text-red" : ""}`}>{inf.realRoe === null ? "–" : pct(inf.realRoe, 1)}</div><div className="text-mute">{t.afterInflSub}</div></div>
            <div className="rounded-xl border border-line p-4"><div className="label">{t.standStill}</div><div className="t-kpi mt-1">{m(inf.keepUp)}</div><div className="text-mute">{t.standStillSub}</div></div>
          </div>
          <ul className="mt-6 space-y-2 text-[13px]">
            {inf.steps.map((s) => <li key={s.key}><b className="font-medium">{s.label}: {m(s.value)}.</b> {s.explain}</li>)}
          </ul>
        </div>
      ) : <p className="mb-10 rounded bg-band px-4 py-3 text-sm">{t.enterInfText}</p>}

      <h2 className="mb-1 text-lg font-semibold">{t.h3}</h2>
      <p className="mb-4 text-sm text-mute">{t.h3Text}</p>
      {x.fx ? (
        <table className="tbl mb-10 max-w-2xl" data-testid="fx"><tbody>
          <tr className="row"><td>{t.fxChange}</td><td>{pct(x.fx.devaluation, 1)}</td></tr>
          <tr className="row"><td>{t.poundValue}</td><td>{pct(-x.fx.poundChange, 1)}</td></tr>
          <tr className="row"><td>{t.reportedUsd}</td><td>{usd(x.fx.reportedUsd)}</td></tr>
          {x.fx.realUsd !== null && <tr className="row"><td>{t.realUsd}</td><td>{usd(x.fx.realUsd)}</td></tr>}
          <tr className="row"><td>{t.eqStart}</td><td>{usd(x.fx.equityStartUsd)}</td></tr>
          <tr className="row"><td>{t.eqEnd}</td><td>{usd(x.fx.equityEndUsd)}</td></tr>
          <tr className="tot"><td>{t.eqChange}</td><td className={(x.fx.equityChangeUsd ?? 0) < 0 ? "text-red" : ""}>{usd(x.fx.equityChangeUsd)}</td></tr>
        </tbody></table>
      ) : <p className="mb-10 rounded bg-band px-4 py-3 text-sm">{t.enterFxText}</p>}

      <details className="mb-6 text-[13px]">
        <summary className="cursor-pointer font-medium">{t.how}</summary>
        <div className="mt-2 space-y-1.5 text-mute">
          {t.howText.map((p) => <p key={p}>{p}</p>)}
        </div>
      </details>
    </>
  );
}

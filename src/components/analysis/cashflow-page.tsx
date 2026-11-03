"use client";
import { useMemo } from "react";
import { cashFlowByMonth, hasPL, indexMonths, money } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { useComments, useAnalysis } from "@/lib/company/use-period";
import { PageHeader } from "@/components/shell/page-header";
import { PeriodPicker } from "@/components/shell/period-picker";
import { CashWaterfall } from "@/components/charts/waterfall";
import { ColumnChart } from "@/components/charts/column-chart";
import { LineChart } from "@/components/charts/line-chart";
import { Legend, MissingData, Notes } from "./common";
import { useT } from "@/lib/i18n/use-t";
import { Cockpit, HeroKpi, KpiTile } from "@/components/viz/kpi";
import { CardGrid, ChartCard } from "@/components/viz/chart-card";
import { Bridge } from "@/components/viz/bridge";
import { SERIES, TONE } from "@/components/viz/palette";

export function CashflowPage() {
  const c = useCompany();
  const a = useAnalysis();
  const comments = useComments();
  // Month by month: the months of a quarter or year, or the twelve months to the selected month.
  const monthly = useMemo(() => {
    if (!a) return null;
    const w = a.view.window;
    const ps = w.periods.length > 1 ? w.periods : indexMonths(c.months).sorted.filter((m) => hasPL(m) && m.period <= w.end).slice(-12).map((m) => m.period);
    return cashFlowByMonth(c.months, ps);
  }, [a, c.months]);
  const T = useT();
  const t = T.d.ana;
  const v = T.d.viz.fin;
  if (!a) return null;
  const cur = c.settings.currency;
  const W = a.W;
  const rows = monthly?.rows ?? [];
  const labels = rows.map((r) => T.ms(r.period));
  const profitOf = (p: string) => { const i = a.view.series.periods.indexOf(p); return i >= 0 ? a.view.series.P[i].net_income : null; };
  const bridge = W ? [
    { label: v.opening, value: W.cash0, total: true },
    { label: t.operating, value: W.ocf },
    { label: t.investing, value: W.fcf - W.ocf },
    { label: t.financing, value: W.ncf - W.fcf },
    ...(W.unreconciled ? [{ label: t.unexplainedCol, value: W.dcash - W.ncf }] : []),
    { label: v.closing, value: W.cash1, total: true },
  ] : [];
  return (
    <>
      <PageHeader title={T.d.nav["analysis/cashflow"][1]} right={<PeriodPicker />} />
      <MissingData view={a.view} basePath={c.basePath} need="cash" />
      {W && (
        <>
          {W.unreconciled !== 0 && (
            <div className="mb-5 rounded-md border border-red/50 bg-red-bg px-4 py-3 text-sm" role="alert" data-testid="cash-unreconciled">
              <b>{t.unexplained(money(W.unreconciled, cur))}</b>{t.unexplainedWhy(a.view.window.end === a.view.window.start)}
              {t.openHealth[0]}<a className="underline" href={`${c.basePath}/data/checks`}>{t.openHealth[1]}</a>{t.openHealth[2]}
            </div>
          )}
          <Cockpit hero={
            <HeroKpi label={t.dcash} testId="tile-dcash" value={money(W.dcash, cur)} neg={W.dcash < 0}
              deltaLabel={`${money(W.cash0, cur, true)} → ${money(W.cash1, cur, true)}`}
              now={rows.length > 1 ? rows.map((r) => r.cash) : undefined}
              story={(() => { const [h, rest] = t.ncfCheck(money(W.dcash, cur), money(W.cash0, cur), money(W.cash1, cur), money(W.ddebt, cur), money(W.debt0, cur), money(W.debt1, cur)); return <span data-testid="ncf-check"><b>{h}</b>{rest}</span>; })()} />
          }>
            <KpiTile label={t.ocf} value={money(W.ocf, cur, true)} neg={W.ocf < 0} testId="tile-ocf" sub={t.ocfTile} now={rows.length > 1 ? rows.map((r) => r.cfo) : undefined} />
            <KpiTile label={t.fcf} value={money(W.fcf, cur, true)} neg={W.fcf < 0} sub={t.fcfTile} now={rows.length > 1 ? rows.map((r) => r.cfo + r.cfi) : undefined} />
            <KpiTile label={t.ncf} value={money(W.ncf, cur, true)} neg={W.ncf < 0} testId="tile-ncf" sub={t.ncfTile} />
            <KpiTile label={v.closing} value={money(W.cash1, cur, true)} neg={W.cash1 < 0} delta={W.cash0 ? ((W.cash1 - W.cash0) / Math.abs(W.cash0)) * 100 : null} sub={t.vsOpening} />
          </Cockpit>
          <CardGrid>
            <ChartCard title={v.cashBridge} sub={v.cashBridgeSub} testId="card-cash-bridge"
              table={{ head: [T.d.viz.item, T.d.viz.value], rows: bridge.map((b) => [b.label, money(b.value, cur)]) }}>
              <Bridge rows={bridge} cur={cur} height={290} testId="cash-bridge" />
            </ChartCard>
            {rows.length > 1 ? (
              <ChartCard title={v.cashVsProfit} sub={v.cashVsProfitSub} testId="card-cash-profit"
                table={{ head: [t.month, t.operating, v.netProfit], rows: rows.map((r) => [T.ml(r.period), money(r.cfo, cur), money(profitOf(r.period), cur)]) }}>
                <LineChart labels={labels} cur={cur} height={270} series={[
                  { name: t.operating, values: rows.map((r) => r.cfo), color: SERIES[0] },
                  { name: v.netProfit, values: rows.map((r) => profitOf(r.period)), color: SERIES[1] },
                ]} />
              </ChartCard>
            ) : null}
            <ChartCard title={v.statement} wide testId="card-cash-statement">
              <Legend items={[{ label: t.received, color: TONE.good }, { label: t.spent, color: TONE.bad }]} />
              <CashWaterfall rows={W.rows} cur={cur} />
            </ChartCard>
          </CardGrid>
        </>
      )}
      {monthly && rows.length > 1 && (
        <section data-testid="cash-monthly">
          <h2 className="mb-1 text-lg font-semibold">{t.monthByMonth}</h2>
          <p className="mb-3 text-sm text-mute">{t.monthByMonthText}{monthly.skipped.length ? t.notShown(monthly.skipped.map(T.ms).join(", ")) : ""}</p>
          <CardGrid>
            <ChartCard title={v.byActivity} wide testId="card-cash-activity"
              table={{ head: [t.month, t.operating, t.investing, t.financing], rows: rows.map((r) => [T.ml(r.period), money(r.cfo, cur), money(r.cfi, cur), money(r.cff, cur)]) }}>
              <ColumnChart testId="cash-columns" cur={cur} labels={labels} series={[
                { name: t.operating, values: rows.map((r) => r.cfo), color: SERIES[0] },
                { name: t.investing, values: rows.map((r) => r.cfi), color: SERIES[1] },
                { name: t.financing, values: rows.map((r) => r.cff), color: SERIES[2] },
              ]} />
            </ChartCard>
            <ChartCard title={v.cashLine} testId="card-cash-line">
              <LineChart testId="cash-balance" cur={cur} height={240} labels={labels} series={[{ name: t.cashAtEnd, values: rows.map((r) => r.cash), color: SERIES[0], fill: true }]} />
            </ChartCard>
            <ChartCard title={v.fcf} sub={v.fcfSub} testId="card-fcf">
              <ColumnChart cur={cur} height={240} labels={labels} series={[{ name: v.fcf, values: rows.map((r) => r.cfo + r.cfi), color: "#0b6e70" }]} />
            </ChartCard>
          </CardGrid>
          <div tabIndex={0} className="overflow-x-auto rounded-xl border border-line p-3">
            <table className="tbl text-[13px]" data-testid="cash-monthly-table">
              <thead><tr><th>{t.month}</th><th>{t.operating}</th><th>{t.investing}</th><th>{t.financing}</th>{rows.some((r) => r.unreconciled) && <th>{t.unexplainedCol}</th>}<th>{t.dcash}</th><th>{t.cashEnd}</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.period} className="row">
                    <td>{T.ms(r.period)}</td><td className={r.cfo < 0 ? "text-red" : ""}>{money(r.cfo, cur)}</td><td>{money(r.cfi, cur)}</td><td>{money(r.cff, cur)}</td>
                    {rows.some((x) => x.unreconciled) && <td className={r.unreconciled ? "text-red" : ""}>{money(r.unreconciled, cur)}</td>}
                    <td className={r.dcash < 0 ? "text-red" : "text-green-d"}>{money(r.dcash, cur)}</td><td className="font-medium">{money(r.cash, cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <Notes findings={a.findings.filter((f) => f.section === "cashflow")} comment={comments("cashflow")} />
    </>
  );
}

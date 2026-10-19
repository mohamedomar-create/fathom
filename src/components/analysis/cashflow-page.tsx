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
import { C } from "@/components/charts/util";
import { Legend, MissingData, MoneyTile, Notes } from "./common";
import { useT } from "@/lib/i18n/use-t";

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
  if (!a) return null;
  const cur = c.settings.currency;
  const W = a.W;
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
          <div className="mb-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <MoneyTile label={t.ocf} value={W.ocf} testId="tile-ocf" sub={t.ocfTile} />
            <MoneyTile label={t.fcf} value={W.fcf} sub={t.fcfTile} />
            <MoneyTile label={t.ncf} value={W.ncf} testId="tile-ncf" sub={t.ncfTile} />
            <MoneyTile label={t.dcash} value={W.dcash} testId="tile-dcash" sub={`${money(W.cash0, cur)} → ${money(W.cash1, cur)}`} />
          </div>
          <Legend items={[{ label: t.received, color: "#2E9E6A" }, { label: t.spent, color: "#D9343A" }]} />
          <CashWaterfall rows={W.rows} cur={cur} />
          <p className="mt-4 text-xs text-mute" data-testid="ncf-check">
            {(() => { const [h, rest] = t.ncfCheck(money(W.dcash, cur), money(W.cash0, cur), money(W.cash1, cur), money(W.ddebt, cur), money(W.debt0, cur), money(W.debt1, cur)); return <><b className="text-ink">{h}</b>{rest}</>; })()}
          </p>
        </>
      )}
      {monthly && monthly.rows.length > 1 && (
        <section className="mt-10" data-testid="cash-monthly">
          <h2 className="mb-1 text-lg font-medium">{t.monthByMonth}</h2>
          <p className="mb-3 text-sm text-mute">{t.monthByMonthText}{monthly.skipped.length ? t.notShown(monthly.skipped.map(T.ms).join(", ")) : ""}</p>
          <ColumnChart testId="cash-columns" cur={cur} labels={monthly.rows.map((r) => T.ms(r.period))} series={[
            { name: t.operating, values: monthly.rows.map((r) => r.cfo), color: C.s[0] },
            { name: t.investing, values: monthly.rows.map((r) => r.cfi), color: C.s[1] },
            { name: t.financing, values: monthly.rows.map((r) => r.cff), color: C.s[2] },
          ]} />
          <div className="mt-6"><LineChart testId="cash-balance" cur={cur} height={220} labels={monthly.rows.map((r) => T.ms(r.period))} series={[{ name: t.cashAtEnd, values: monthly.rows.map((r) => r.cash), color: C.s[0], fill: true }]} /></div>
          <div className="mt-6 overflow-x-auto">
            <table className="tbl text-[13px]" data-testid="cash-monthly-table">
              <thead><tr><th>{t.month}</th><th>{t.operating}</th><th>{t.investing}</th><th>{t.financing}</th>{monthly.rows.some((r) => r.unreconciled) && <th>{t.unexplainedCol}</th>}<th>{t.dcash}</th><th>{t.cashEnd}</th></tr></thead>
              <tbody>
                {monthly.rows.map((r) => (
                  <tr key={r.period}>
                    <td>{T.ms(r.period)}</td><td>{money(r.cfo, cur)}</td><td>{money(r.cfi, cur)}</td><td>{money(r.cff, cur)}</td>
                    {monthly.rows.some((x) => x.unreconciled) && <td className={r.unreconciled ? "text-red" : ""}>{money(r.unreconciled, cur)}</td>}
                    <td>{money(r.dcash, cur)}</td><td>{money(r.cash, cur)}</td>
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

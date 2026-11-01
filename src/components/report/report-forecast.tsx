"use client";
import { useMemo } from "react";
import { forecast, METHOD_LABEL, METHOD_LABEL_AR, mlabel, money, mshort, pct, plCalc, bsCalc, type ForecastMonth, hasPL } from "@/lib/engine";
import { LineChart } from "@/components/charts/line-chart";
import type { ReportInput } from "@/lib/report/types";
import { useT } from "@/lib/i18n/use-t";

const Tile = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="border-t-2 border-line pt-1.5"><div className="label">{label}</div><div className="num text-[19px]">{value}</div>{sub && <div className="text-[10.5px] text-mute">{sub}</div>}</div>
);

/** The forecast from the latest month loaded: headline, revenue and cash lines, the year by quarter and how well it tested. */
export function ReportForecast({ input, head }: { input: ReportInput; head: (title: string, label: string) => React.ReactNode }) {
  const T = useT();
  const t = T.d.rep.doc;
  const ar = T.lang === "ar";
  const ml = (p: string) => (ar ? T.ml(p) : mlabel(p));
  const ms = (p: string) => (ar ? T.ms(p) : mshort(p));
  const cur = input.settings.currency;
  const f = useMemo(() => forecast(input.months, input.settings, input.forecast ?? {}, input.assumptions ?? {}, input.asOf ?? undefined, T.lang), [input.months, input.settings, input.forecast, input.assumptions, input.asOf, T.lang]);
  if (!f.ok) return <>{head(T.d.rep.secs.forecast, t.latestFigures)}<p className="text-mute">{f.reason}</p></>;
  const s = f.summary;
  // Actual months up to the month the forecast starts from (months holding a P&L; a part month the forecast skips is left out).
  const hist = [...input.months].filter((m) => hasPL(m) && m.period < f.months[0].period).sort((a, b) => a.period.localeCompare(b.period)).slice(-12);
  const H = hist.length;
  const labels = [...hist.map((m) => m.period), ...f.months.map((m) => m.period)].map(ms);
  const joined = (actual: number[], fc: number[]) => [...actual.slice(0, -1).map(() => null), actual[H - 1], ...fc];
  const rev = hist.map((m) => plCalc(m.pl).revenue), cash = hist.map((m) => bsCalc(m.bs).cash);
  const quarters: ForecastMonth[][] = [];
  f.months.slice(0, 12).forEach((m, i) => { (quarters[Math.floor(i / 3)] ??= []).push(m); });
  const qsum = (q: ForecastMonth[], g: (m: ForecastMonth) => number) => q.reduce((t, m) => t + g(m), 0);
  const rows: [string, (m: ForecastMonth) => number, boolean?][] = [
    [t.revenue, (m) => m.P.revenue], [t.grossProfit, (m) => m.P.gross_profit], [t.ebit, (m) => m.P.ebit], [t.netProfit, (m) => m.P.net_income, true],
    [t.ocf, (m) => m.W.ocf], [t.fcf, (m) => m.W.fcf, true],
  ];
  const bt = f.backtest;
  return (
    <>
      {head(T.d.rep.secs.forecast, t.fromTo(ml(f.start), ml(f.end)))}
      <div className="mb-4 grid grid-cols-4 gap-4">
        <Tile label={t.rev12} value={money(s.revenue12, cur, true)} sub={s.growth12 === null ? undefined : t.onLast(`${s.growth12 >= 0 ? "+" : ""}${pct(s.growth12, 1)}`)} />
        <Tile label={t.profit12} value={money(s.netIncome12, cur, true)} sub={s.netIncomeLast12 === null ? undefined : t.last12(money(s.netIncomeLast12, cur, true))} />
        <Tile label={t.lowCash} value={money(s.lowCash, cur, true)} sub={t.inMonth(ml(s.lowCashMonth))} />
        <Tile label={t.cashAt(ms(f.end))} value={money(s.closingCash, cur, true)} />
      </div>
      <p className="mb-3 text-[11.5px]" data-testid="report-fc-verdict">{s.cashNegativeFrom
        ? <>{t.runsOut(ml(s.cashNegativeFrom), money(s.fundingNeed, cur), ml(s.lowCashMonth)).map((x, i) => (i % 2 ? <b key={i}>{x}</b> : x))}</>
        : <>{t.positive(money(s.lowCash, cur), ml(s.lowCashMonth)).map((x, i) => (i % 2 ? <b key={i}>{x}</b> : x))}</>}</p>
      <div className="mb-4 grid grid-cols-2 gap-6">
        <div><div className="label mb-1">{t.revRange}</div>
          <LineChart labels={labels} cur={cur} height={190} legend={false} series={[
            { name: t.actual, values: [...rev, ...f.months.map(() => null)], color: "#0B6E70" },
            { name: t.forecast, values: joined(rev, f.months.map((m) => m.P.revenue)), color: "#0B6E70", dashed: true, dots: false },
            { name: t.rangeLow, values: joined(rev, f.months.map((m) => m.revenueLow)), color: "#9CC9C9", dashed: true, dots: false },
            { name: t.rangeHigh, values: joined(rev, f.months.map((m) => m.revenueHigh)), color: "#9CC9C9", dashed: true, dots: false },
          ]} /></div>
        <div><div className="label mb-1">{t.cashFc}</div>
          <LineChart labels={labels} cur={cur} height={190} legend={false} series={[
            { name: t.actual, values: [...cash, ...f.months.map(() => null)], color: "#2E9E6A" },
            { name: t.forecast, values: joined(cash, f.months.map((m) => m.B.cash)), color: "#2E9E6A", dashed: true, dots: false },
          ]} /></div>
      </div>
      <table className="tbl text-[10.5px]" data-testid="report-fc-table">
        <thead><tr><th>{t.next12}</th>{quarters.map((q) => <th key={q[0].period}>{ms(q[0].period)}–{ms(q[q.length - 1].period)}</th>)}<th>{t.total}</th></tr></thead>
        <tbody>{rows.map(([l, g, tot]) => (
          <tr key={l} className={tot ? "tot" : ""}><td>{l}</td>{quarters.map((q) => <td key={q[0].period}>{money(qsum(q, g), cur, true)}</td>)}<td>{money(f.months.slice(0, 12).reduce((t, m) => t + g(m), 0), cur, true)}</td></tr>
        ))}</tbody>
      </table>
      <p className="mt-3 text-[10px] text-mute">
        {t.method((ar ? METHOD_LABEL_AR : METHOD_LABEL)[f.method])}{bt ? t.tested(bt.months, pct(bt.revenueMape, 1)) : ""}{" "}
        {t.used(Math.round(f.used.dso), Math.round(f.used.dio), Math.round(f.used.dpo), pct(f.used.costInflation, 1), pct(f.used.rate, 1))}
        {f.notes.length ? ` ${f.notes.join(" ")}` : ""}{t.notPromise}
      </p>
    </>
  );
}

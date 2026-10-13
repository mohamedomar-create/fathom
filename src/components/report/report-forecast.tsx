"use client";
import { useMemo } from "react";
import { forecast, METHOD_LABEL, mlabel, money, mshort, pct, plCalc, bsCalc, type ForecastMonth, hasPL } from "@/lib/engine";
import { LineChart } from "@/components/charts/line-chart";
import type { ReportInput } from "@/lib/report/types";

const Tile = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="border-t-2 border-line pt-1.5"><div className="label">{label}</div><div className="num text-[19px]">{value}</div>{sub && <div className="text-[10.5px] text-mute">{sub}</div>}</div>
);

/** The forecast from the latest month loaded: headline, revenue and cash lines, the year by quarter and how well it tested. */
export function ReportForecast({ input, head }: { input: ReportInput; head: (title: string, label: string) => React.ReactNode }) {
  const cur = input.settings.currency;
  const f = useMemo(() => forecast(input.months, input.settings, input.forecast ?? {}, input.assumptions ?? {}), [input.months, input.settings, input.forecast, input.assumptions]);
  if (!f.ok) return <>{head("Forecast", "latest figures")}<p className="text-mute">{f.reason}</p></>;
  const s = f.summary;
  // Actual months up to the month the forecast starts from (months holding a P&L; a part month the forecast skips is left out).
  const hist = [...input.months].filter((m) => hasPL(m) && m.period < f.months[0].period).sort((a, b) => a.period.localeCompare(b.period)).slice(-12);
  const H = hist.length;
  const labels = [...hist.map((m) => m.period), ...f.months.map((m) => m.period)].map(mshort);
  const joined = (actual: number[], fc: number[]) => [...actual.slice(0, -1).map(() => null), actual[H - 1], ...fc];
  const rev = hist.map((m) => plCalc(m.pl).revenue), cash = hist.map((m) => bsCalc(m.bs).cash);
  const quarters: ForecastMonth[][] = [];
  f.months.slice(0, 12).forEach((m, i) => { (quarters[Math.floor(i / 3)] ??= []).push(m); });
  const qsum = (q: ForecastMonth[], g: (m: ForecastMonth) => number) => q.reduce((t, m) => t + g(m), 0);
  const rows: [string, (m: ForecastMonth) => number, boolean?][] = [
    ["Revenue", (m) => m.P.revenue], ["Gross profit", (m) => m.P.gross_profit], ["EBIT", (m) => m.P.ebit], ["Net profit", (m) => m.P.net_income, true],
    ["Operating cash flow", (m) => m.W.ocf], ["Free cash flow", (m) => m.W.fcf, true],
  ];
  const bt = f.backtest;
  return (
    <>
      {head("Forecast", `${mlabel(f.start)} to ${mlabel(f.end)}`)}
      <div className="mb-4 grid grid-cols-4 gap-4">
        <Tile label="Revenue, next 12 months" value={money(s.revenue12, cur, true)} sub={s.growth12 === null ? undefined : `${s.growth12 >= 0 ? "+" : ""}${pct(s.growth12, 1)} on the last 12 months`} />
        <Tile label="Net profit, next 12 months" value={money(s.netIncome12, cur, true)} sub={s.netIncomeLast12 === null ? undefined : `last 12 months ${money(s.netIncomeLast12, cur, true)}`} />
        <Tile label="Lowest cash" value={money(s.lowCash, cur, true)} sub={`in ${mlabel(s.lowCashMonth)}`} />
        <Tile label={`Cash at ${mshort(f.end)}`} value={money(s.closingCash, cur, true)} />
      </div>
      <p className="mb-3 text-[11.5px]" data-testid="report-fc-verdict">{s.cashNegativeFrom
        ? <>Cash runs out in <b>{mlabel(s.cashNegativeFrom)}</b>; about <b>{money(s.fundingNeed, cur)}</b> of extra funding is needed by {mlabel(s.lowCashMonth)}.</>
        : <>Cash stays positive throughout; the lowest point is <b>{money(s.lowCash, cur)}</b> in {mlabel(s.lowCashMonth)}.</>}</p>
      <div className="mb-4 grid grid-cols-2 gap-6">
        <div><div className="label mb-1">Revenue (dashed: forecast and likely range)</div>
          <LineChart labels={labels} cur={cur} height={190} legend={false} series={[
            { name: "Actual", values: [...rev, ...f.months.map(() => null)], color: "#0B6E70" },
            { name: "Forecast", values: joined(rev, f.months.map((m) => m.P.revenue)), color: "#0B6E70", dashed: true, dots: false },
            { name: "Range, low", values: joined(rev, f.months.map((m) => m.revenueLow)), color: "#9CC9C9", dashed: true, dots: false },
            { name: "Range, high", values: joined(rev, f.months.map((m) => m.revenueHigh)), color: "#9CC9C9", dashed: true, dots: false },
          ]} /></div>
        <div><div className="label mb-1">Cash on hand (dashed: forecast)</div>
          <LineChart labels={labels} cur={cur} height={190} legend={false} series={[
            { name: "Actual", values: [...cash, ...f.months.map(() => null)], color: "#2E9E6A" },
            { name: "Forecast", values: joined(cash, f.months.map((m) => m.B.cash)), color: "#2E9E6A", dashed: true, dots: false },
          ]} /></div>
      </div>
      <table className="tbl text-[10.5px]" data-testid="report-fc-table">
        <thead><tr><th>Next 12 months</th>{quarters.map((q) => <th key={q[0].period}>{mshort(q[0].period)}–{mshort(q[q.length - 1].period)}</th>)}<th>Total</th></tr></thead>
        <tbody>{rows.map(([l, g, tot]) => (
          <tr key={l} className={tot ? "tot" : ""}><td>{l}</td>{quarters.map((q) => <td key={q[0].period}>{money(qsum(q, g), cur, true)}</td>)}<td>{money(f.months.slice(0, 12).reduce((t, m) => t + g(m), 0), cur, true)}</td></tr>
        ))}</tbody>
      </table>
      <p className="mt-3 text-[10px] text-mute">
        Revenue method: {METHOD_LABEL[f.method]}.{bt ? ` Tested on the last ${bt.months} months held: revenue off by ${pct(bt.revenueMape, 1)} a month on average.` : ""}{" "}
        Customer days {Math.round(f.used.dso)}, stock days {Math.round(f.used.dio)}, supplier days {Math.round(f.used.dpo)}; fixed costs rise {pct(f.used.costInflation, 1)} a year; borrowing rate {pct(f.used.rate, 1)}.
        {f.notes.length ? ` ${f.notes.join(" ")}` : ""} A forecast, not a promise: it shows where today&apos;s pattern leads.
      </p>
    </>
  );
}

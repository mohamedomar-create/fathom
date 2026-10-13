"use client";
import { useMemo } from "react";
import { cashFlowByMonth, hasPL, indexMonths, money, mshort } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { useComments, useAnalysis } from "@/lib/company/use-period";
import { PageHeader } from "@/components/shell/page-header";
import { PeriodPicker } from "@/components/shell/period-picker";
import { CashWaterfall } from "@/components/charts/waterfall";
import { ColumnChart } from "@/components/charts/column-chart";
import { LineChart } from "@/components/charts/line-chart";
import { C } from "@/components/charts/util";
import { Legend, MissingData, MoneyTile, Notes } from "./common";

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
  if (!a) return null;
  const cur = c.settings.currency;
  const W = a.W;
  return (
    <>
      <PageHeader title="Cash Flow" right={<PeriodPicker />} />
      <MissingData view={a.view} basePath={c.basePath} need="cash" />
      {W && (
        <>
          {W.unreconciled !== 0 && (
            <div className="mb-5 rounded-md border border-red/50 bg-red-bg px-4 py-3 text-sm" role="alert" data-testid="cash-unreconciled">
              <b>{money(W.unreconciled, cur)} of the change in cash cannot be explained by the statements.</b> The balance sheet does not balance in {a.view.window.end === a.view.window.start ? "this month or the month before" : "the period's last month or the month before it starts"}, or an account is not mapped.
              Open <a className="underline" href={`${c.basePath}/settings/data-health`}>Data health</a> to see which month is out and by how much, then map the account or re-export the General Ledger.
            </div>
          )}
          <div className="mb-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <MoneyTile label="Operating cash flow" value={W.ocf} testId="tile-ocf" sub="from trading, after tax, before interest" />
            <MoneyTile label="Free cash flow" value={W.fcf} sub="after investment in assets" />
            <MoneyTile label="Cash flow before borrowing" value={W.ncf} testId="tile-ncf" sub="change in cash less new borrowing" />
            <MoneyTile label="Change in cash" value={W.dcash} testId="tile-dcash" sub={`${money(W.cash0, cur)} → ${money(W.cash1, cur)}`} />
          </div>
          <Legend items={[{ label: "Cash Received", color: "#2E9E6A" }, { label: "Cash Spent", color: "#D9343A" }]} />
          <CashWaterfall rows={W.rows} cur={cur} />
          <p className="mt-4 text-xs text-mute" data-testid="ncf-check">
            <b className="text-ink">CASH FLOW BEFORE BORROWING CAN ALSO BE CALCULATED AS:</b> Change in Cash on Hand {money(W.dcash, cur)} (Open: {money(W.cash0, cur)}, Close: {money(W.cash1, cur)}) − Change in Debt {money(W.ddebt, cur)} (Open: {money(W.debt0, cur)}, Close: {money(W.debt1, cur)})
          </p>
        </>
      )}
      {monthly && monthly.rows.length > 1 && (
        <section className="mt-10" data-testid="cash-monthly">
          <h2 className="mb-1 text-lg font-medium">Month by month</h2>
          <p className="mb-3 text-sm text-mute">Operating, investing and financing cash each month (IAS 7, interest under financing), and the cash balance at each month end.{monthly.skipped.length ? ` Not shown: ${monthly.skipped.map(mshort).join(", ")} (a balance sheet or P&L is not loaded).` : ""}</p>
          <ColumnChart testId="cash-columns" cur={cur} labels={monthly.rows.map((r) => mshort(r.period))} series={[
            { name: "Operating", values: monthly.rows.map((r) => r.cfo), color: C.s[0] },
            { name: "Investing", values: monthly.rows.map((r) => r.cfi), color: C.s[1] },
            { name: "Financing", values: monthly.rows.map((r) => r.cff), color: C.s[2] },
          ]} />
          <div className="mt-6"><LineChart testId="cash-balance" cur={cur} height={220} labels={monthly.rows.map((r) => mshort(r.period))} series={[{ name: "Cash at month end", values: monthly.rows.map((r) => r.cash), color: C.s[0], fill: true }]} /></div>
          <div className="mt-6 overflow-x-auto">
            <table className="tbl text-[13px]" data-testid="cash-monthly-table">
              <thead><tr><th>Month</th><th>Operating</th><th>Investing</th><th>Financing</th>{monthly.rows.some((r) => r.unreconciled) && <th>Unexplained</th>}<th>Change in cash</th><th>Cash at end</th></tr></thead>
              <tbody>
                {monthly.rows.map((r) => (
                  <tr key={r.period}>
                    <td>{mshort(r.period)}</td><td>{money(r.cfo, cur)}</td><td>{money(r.cfi, cur)}</td><td>{money(r.cff, cur)}</td>
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

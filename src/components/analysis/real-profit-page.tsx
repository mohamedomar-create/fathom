"use client";
import { useMemo } from "react";
import { money, pct, realProfit, twelveMonths, type WaterfallRow } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { usePeriod } from "@/lib/company/use-period";
import { PageHeader } from "@/components/shell/page-header";
import { PeriodPicker } from "@/components/shell/period-picker";
import { CashWaterfall } from "@/components/charts/waterfall";
import { AssumptionsPanel, useAssumptions } from "./assumptions";
import { Tile } from "./common";

const usd = (v: number | null) => (v === null ? "–" : money(v, "USD"));

export function RealProfitPage() {
  const c = useCompany();
  const { sel } = usePeriod();
  const cur = c.settings.currency;
  const { a, setA, saved } = useAssumptions();
  const target = c.settings.targets?.ar_days ?? 45;
  const basis = useMemo(() => (sel.end ? twelveMonths(c.months, sel.end, c.settings.fyStartMonth) : null), [c.months, sel.end, c.settings.fyStartMonth]);
  const x = useMemo(() => (basis ? realProfit(basis, a, cur, target ?? 45) : null), [basis, a, cur, target]);
  if (!basis || !x) return null;
  const m = (v: number | null) => (v === null ? "–" : money(v, cur));
  const col = x.collection;
  const inf = x.inflation;
  const rows: WaterfallRow[] = inf ? [
    { label: "Reported net profit", sign: "TOTAL", value: x.reported },
    ...inf.steps.map((s): WaterfallRow => ({ label: s.label, sign: s.value >= 0 ? "ADD" : "LESS", value: s.value, info: s.explain })),
    { label: "Real profit at today's prices", sign: "TOTAL", value: inf.real },
  ] : [];
  return (
    <>
      <PageHeader title="Real Profit" right={<PeriodPicker />}>
        <p className="text-sm text-mute" data-testid="real-basis">What the profit in the books is really worth after customers&apos; payment delays, inflation and the pound&apos;s exchange rate, on the <b className="text-ink">{basis.label}</b>.</p>
      </PageHeader>

      <div className="mb-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Reported net profit" value={money(x.reported, cur, true)} neg={x.reported < 0} sub={<span className="text-mute">as in the books</span>} testId="tile-reported" />
        <Tile label="Cash from operations" value={x.cashProfit === null ? "–" : money(x.cashProfit, cur, true)} neg={(x.cashProfit ?? 0) < 0} sub={<span className="text-mute">{x.cashProfit === null ? "needs the month before" : "operating cash flow: what profit brought in"}</span>} />
        <Tile label="Real profit" value={inf ? money(inf.real, cur, true) : "–"} neg={!!inf && inf.real < 0} sub={<span className="text-mute">{inf ? `after ${pct(inf.periodRate, 1)} inflation` : "enter inflation below"}</span>} testId="tile-real" />
        <Tile label="Profit in US dollars" value={x.fx ? usd(x.fx.reportedUsd) : "–"} neg={!!x.fx && x.fx.reportedUsd < 0} sub={<span className="text-mute">{x.fx ? `pound ${x.fx.devaluation >= 0 ? "fell" : "rose"} ${pct(Math.abs(x.fx.devaluation), 1)} against the dollar` : "enter exchange rates below"}</span>} />
      </div>

      <div className="mb-10">
        <AssumptionsPanel fields={["inflation", "fxStart", "fxEnd", "importShare", "assetAge", "rate"]} a={a} setA={setA} saved={saved} />
      </div>

      <h2 className="mb-1 text-xl font-light">1. Cash collection: profit you have not received yet</h2>
      <p className="mb-4 text-sm text-mute">Profit is booked when you invoice; it is only yours to spend when the customer pays.</p>
      <div className="mb-10 grid gap-6 lg:grid-cols-2" data-testid="collection">
        <table className="tbl"><tbody>
          <tr className="row"><td>Sales invoiced</td><td>{m(col.revenue)}</td></tr>
          <tr className="row"><td>Increase in what customers owe</td><td>{col.stuck === null ? "needs the month before" : m(-col.stuck)}</td></tr>
          <tr className="tot"><td>Cash collected from sales</td><td>{m(col.collected)}</td></tr>
          <tr className="row"><td>Collection rate</td><td>{col.rate === null ? "–" : pct(col.rate, 1)}</td></tr>
          <tr className="row"><td>Customer days (DSO)</td><td>{col.dso === null ? "–" : `${Math.round(col.dso)} days`}</td></tr>
        </tbody></table>
        <div className="space-y-3 text-[13px]">
          {col.dso !== null && <p>Customers take <b>{Math.round(col.dso)} days</b> to pay on average, so about <b>{m(col.avgAR)}</b> of your money is held by them at any time.</p>}
          {col.creditCost !== null ? (
            <>
              <p>At your borrowing rate of {pct(a.rate ?? 0, 1)}, financing that credit costs about <b>{m(col.creditCost)}</b> over the period, and every extra day customers take costs about <b>{m(col.perDay)}</b> a year.</p>
              {col.release !== null && <p className="rounded bg-brand-bg px-3 py-2">Bringing customer days down to your target of {Math.round(col.targetDso)} would release <b>{m(col.release)}</b> of cash and save about <b>{m(col.saving)}</b> of interest a year.</p>}
            </>
          ) : <p className="text-mute">Enter your borrowing rate to see what customer credit costs you.</p>}
        </div>
      </div>

      <h2 className="mb-1 text-xl font-light">2. Inflation: from reported to real profit</h2>
      <p className="mb-4 text-sm text-mute">Accounts are kept in pounds of different dates. These adjustments restate the year in today&apos;s pounds, so profit means real gain in purchasing power. Hover the ⓘ for the working.</p>
      {inf ? (
        <div className="mb-10" data-testid="real-bridge">
          <CashWaterfall rows={rows} cur={cur} />
          <div className="mt-6 grid gap-4 text-[13px] sm:grid-cols-3">
            <div className="rounded-md bg-band p-3"><div className="label">Return on equity</div><div className="num mt-1 text-xl">{inf.roe === null ? "–" : pct(inf.roe, 1)}</div><div className="text-mute">a year, as reported</div></div>
            <div className="rounded-md bg-band p-3"><div className="label">After inflation</div><div className={`num mt-1 text-xl ${inf.realRoe !== null && inf.realRoe < 0 ? "text-red" : ""}`}>{inf.realRoe === null ? "–" : pct(inf.realRoe, 1)}</div><div className="text-mute">what owners really gained</div></div>
            <div className="rounded-md bg-band p-3"><div className="label">Profit needed to stand still</div><div className="num mt-1 text-xl">{m(inf.keepUp)}</div><div className="text-mute">to keep opening equity at today&apos;s prices</div></div>
          </div>
          <ul className="mt-6 space-y-2 text-[13px]">
            {inf.steps.map((s) => <li key={s.key}><b className="font-medium">{s.label}: {m(s.value)}.</b> {s.explain}</li>)}
          </ul>
        </div>
      ) : <p className="mb-10 rounded bg-band px-4 py-3 text-sm">Enter the inflation rate for these 12 months above to see real profit.</p>}

      <h2 className="mb-1 text-xl font-light">3. Devaluation: the result in hard currency</h2>
      <p className="mb-4 text-sm text-mute">For owners and lenders who think in dollars. Exchange gains and losses on foreign-currency balances are already in reported profit when the books revalue them at the period end (EAS 13).</p>
      {x.fx ? (
        <table className="tbl mb-10 max-w-2xl" data-testid="fx"><tbody>
          <tr className="row"><td>Change in the USD rate over the period</td><td>{pct(x.fx.devaluation, 1)}</td></tr>
          <tr className="row"><td>Reported profit in USD (average rate)</td><td>{usd(x.fx.reportedUsd)}</td></tr>
          {x.fx.realUsd !== null && <tr className="row"><td>Real profit in USD</td><td>{usd(x.fx.realUsd)}</td></tr>}
          <tr className="row"><td>Owners&apos; equity in USD at the start</td><td>{usd(x.fx.equityStartUsd)}</td></tr>
          <tr className="row"><td>Owners&apos; equity in USD at the end</td><td>{usd(x.fx.equityEndUsd)}</td></tr>
          <tr className="tot"><td>Change in owners&apos; wealth in USD</td><td className={(x.fx.equityChangeUsd ?? 0) < 0 ? "text-red" : ""}>{usd(x.fx.equityChangeUsd)}</td></tr>
        </tbody></table>
      ) : <p className="mb-10 rounded bg-band px-4 py-3 text-sm">Enter the USD rate at the start and end of the period above.</p>}

      <details className="mb-6 text-[13px]">
        <summary className="cursor-pointer font-medium">How this is calculated</summary>
        <div className="mt-2 space-y-1.5 text-mute">
          <p>Money held or owed (cash, receivables, borrowing, suppliers, taxes) gains or loses purchasing power: average balance × inflation over the period. Average balances use every month-end held in the period.</p>
          <p>Stock sold was bought earlier at lower prices. Replacing it costs cost of sales × the price rise over the stock days; imported stock rises with the dollar, local stock with inflation.</p>
          <p>Depreciation is on what the assets cost when bought; at today&apos;s prices it is higher by the inflation since then.</p>
          <p>Prepayments and other current assets are left out. This is a simplified form of the method in IAS 29 for high inflation, meant for management decisions, not statutory accounts.</p>
        </div>
      </details>
    </>
  );
}

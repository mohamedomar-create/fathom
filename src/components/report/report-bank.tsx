"use client";
import { useMemo } from "react";
import { bankPack, formatBankValue, money, pct, realProfit, realProfitSummary, twelveMonths, type Band, type WaterfallRow } from "@/lib/engine";
import { CashWaterfall } from "@/components/charts/waterfall";
import { breakingPoints, ProFormaTable, StressTable, TrendTable } from "@/components/analysis/bank-tables";
import { MemoText } from "@/components/analysis/memo-box";
import { cn } from "@/lib/cn";
import type { ReportInput } from "@/lib/report/types";

const BAND: Record<Band, [string, string]> = {
  strong: ["Strong", "text-green-d"], watch: ["Watch", "text-[#9a6b00]"], weak: ["Weak", "text-red"], info: ["–", "text-mute"],
};

function useBank(input: ReportInput) {
  return useMemo(() => bankPack(input.months, input.sel.end, input.settings, input.assumptions ?? {}, input.companyName), [input.months, input.sel.end, input.settings, input.assumptions, input.companyName]);
}

const Tile = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="border-t-2 border-line pt-1.5"><div className="label">{label}</div><div className="num text-[19px]">{value}</div>{sub && <div className="text-[10.5px] text-mute">{sub}</div>}</div>
);

/** Bank Readiness: the measures a credit analyst checks, the questions to expect and the discussion memo. */
export function ReportBank({ input, head }: { input: ReportInput; head: (title: string, label: string) => React.ReactNode }) {
  const p = useBank(input);
  const cur = input.settings.currency;
  const { assessment: a, pf } = p;
  const r = (k: string) => a.ratios.find((x) => x.key === k)!;
  const memo = input.commentary.bank || p.memo;
  return (
    <>
      {head("Bank Readiness", p.basis.label)}
      <div className="mb-4 grid grid-cols-4 gap-4">
        <Tile label="Debt service cover" value={formatBankValue(r("dscr"), cur)} sub="guide 1.25x or more" />
        <Tile label="Debt to EBITDA" value={formatBankValue(r("debt_ebitda"), cur)} sub="guide 3x or less" />
        <Tile label="Room to borrow" value={a.capacity.headroom === null ? "–" : money(a.capacity.headroom, cur, true)} sub={a.capacity.rate === null ? "rate not given" : `at ${pct(a.capacity.rate, 1)}, ${a.capacity.tenor} years`} />
        <Tile label="Request" value={pf ? money(pf.amount, cur, true) : "–"} sub={pf ? (pf.fits === true ? "fits common limits" : pf.fits === false ? "beyond common limits" : "") : "none entered"} />
      </div>
      <div>
        <table className="tbl text-[10.5px]" data-testid="report-bank-ratios">
          <thead><tr><th>Measure</th><th>Value</th><th>Guide</th><th></th></tr></thead>
          <tbody>{a.ratios.filter((x) => x.band !== "info").map((x) => (
            <tr key={x.key}><td>{x.name}{x.estimate ? "*" : ""}</td><td>{formatBankValue(x, cur)}</td><td className="text-mute">{x.guide}</td><td className={cn("font-medium", BAND[x.band][1])}>{BAND[x.band][0]}</td></tr>
          ))}</tbody>
        </table>
        <div className="rcomment"><div className="label mb-1">{input.commentary.bank ? "Bank discussion memo" : "Bank discussion memo (automatic)"}</div><MemoText text={memo} className="!space-y-2 !text-[11px] [&>div:not(:first-child)]:break-inside-avoid columns-2 gap-6" /></div>
      </div>
      {a.principalEstimated && a.principal12m > 0 && <p className="mt-2 text-[10px] text-mute">* Loan repayments estimated as long-term loans ÷ {a.capacity.tenor} years.</p>}
      <p className="mt-3 text-[10px] text-mute">Guides are common lender rules of thumb for small and mid-sized companies; each bank applies its own policy. Not a credit decision.</p>
    </>
  );
}

/** Three-year trend, stress test and the request tested. */
export function ReportBankOutlook({ input, head }: { input: ReportInput; head: (title: string, label: string) => React.ReactNode }) {
  const p = useBank(input);
  const cur = input.settings.currency;
  return (
    <>
      {head("Bank: Trend & Stress Test", p.basis.label)}
      <div className="label mb-1">Three-year view</div>
      <TrendTable trend={p.trend} cur={cur} small />
      {p.trend.years.length < 3 && <p className="mt-1 text-[10px] text-mute">{p.trend.years.length === 1 ? "One complete year" : `${p.trend.years.length} complete years`} of figures loaded.</p>}
      <div className="label mb-1 mt-5">Stress test</div>
      <p className="mb-2 text-[11.5px]">{breakingPoints(p.stress)}</p>
      <StressTable stress={p.stress} cur={cur} small />
      {p.pf && <><div className="label mb-1 mt-5">The request</div><ProFormaTable pf={p.pf} a={p.assessment} cur={cur} small /></>}
    </>
  );
}

/** Reported against real profit: inflation bridge, collection and the dollar view. */
export function ReportRealProfit({ input, head }: { input: ReportInput; head: (title: string, label: string) => React.ReactNode }) {
  const cur = input.settings.currency;
  const { basis, x } = useMemo(() => {
    const basis = twelveMonths(input.months, input.sel.end, input.settings.fyStartMonth);
    return { basis, x: realProfit(basis, input.assumptions ?? {}, cur, input.settings.targets?.ar_days ?? 45) };
  }, [input.months, input.sel.end, input.settings, input.assumptions, cur]);
  const inf = x.inflation;
  const rows: WaterfallRow[] = inf ? [
    { label: "Reported net profit", sign: "TOTAL", value: x.reported },
    ...inf.steps.map((s): WaterfallRow => ({ label: s.label, sign: s.value >= 0 ? "ADD" : "LESS", value: s.value })),
    { label: "Real profit at today's prices", sign: "TOTAL", value: inf.real },
  ] : [];
  const as = input.assumptions ?? {};
  const col = x.collection;
  return (
    <>
      {head("Real Profit", basis.label)}
      <div className="mb-4 grid grid-cols-4 gap-4">
        <Tile label="Reported net profit" value={money(x.reported, cur, true)} />
        <Tile label="Cash from operations" value={x.cashProfit === null ? "–" : money(x.cashProfit, cur, true)} />
        <Tile label="Real profit" value={inf ? money(inf.real, cur, true) : "–"} sub={inf ? `after ${pct(inf.periodRate, 1)} inflation` : "inflation not entered"} />
        <Tile label="Profit in USD" value={x.fx ? money(x.fx.reportedUsd, "USD", true) : "–"} sub={x.fx ? `USD rate ${pct(x.fx.devaluation, 1)}` : "rates not entered"} />
      </div>
      {inf ? <CashWaterfall rows={rows} cur={cur} /> : <p className="text-mute">Enter the inflation rate in Real Profit to show the bridge.</p>}
      <div className="mt-5 grid grid-cols-2 gap-6 text-[11.5px]">
        <table className="tbl"><tbody>
          <tr><td>Sales invoiced</td><td>{money(col.revenue, cur)}</td></tr>
          <tr><td>Cash collected from sales</td><td>{col.collected === null ? "–" : money(col.collected, cur)}</td></tr>
          <tr><td>Collection rate</td><td>{col.rate === null ? "–" : pct(col.rate, 1)}</td></tr>
          <tr><td>Customer days</td><td>{col.dso === null ? "–" : Math.round(col.dso)}</td></tr>
          {col.creditCost !== null && <tr><td>Cost of customer credit</td><td>{money(col.creditCost, cur)}</td></tr>}
        </tbody></table>
        <table className="tbl"><tbody>
          {inf && <><tr><td>Return on equity</td><td>{inf.roe === null ? "–" : pct(inf.roe, 1)}</td></tr><tr><td>After inflation</td><td>{inf.realRoe === null ? "–" : pct(inf.realRoe, 1)}</td></tr></>}
          {x.fx && <><tr><td>Owners&apos; equity in USD, start</td><td>{x.fx.equityStartUsd === null ? "–" : money(x.fx.equityStartUsd, "USD")}</td></tr><tr><td>Owners&apos; equity in USD, end</td><td>{money(x.fx.equityEndUsd, "USD")}</td></tr></>}
        </tbody></table>
      </div>
      <div className="rcomment whitespace-pre-line">{input.commentary.realprofit || realProfitSummary(x, cur)}</div>
      <p className="mt-2 text-[10px] text-mute">
        Rates used: inflation {as.inflation ?? "–"}%, USD {as.fxStart ?? "–"} → {as.fxEnd ?? "–"}, imported stock {as.importShare ?? 0}%, asset age {as.assetAge ?? "–"} years{as.example ? " (example figures)" : ""}. A simplified form of IAS 29 for management use, not statutory accounts.
      </p>
    </>
  );
}

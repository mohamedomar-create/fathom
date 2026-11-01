"use client";
import { useMemo } from "react";
import { BANK_LIMITS, bankPack, formatBankValue, readMemo, money, pct, realProfit, realProfitSummary, twelveMonths, type Band, type WaterfallRow } from "@/lib/engine";
import { CashWaterfall } from "@/components/charts/waterfall";
import { breakingPoints, ProFormaTable, StressTable, TrendTable } from "@/components/analysis/bank-tables";
import { MemoText } from "@/components/analysis/memo-box";
import { cn } from "@/lib/cn";
import type { ReportInput } from "@/lib/report/types";
import { useT } from "@/lib/i18n/use-t";

const BAND: Record<Band, [string, string]> = {
  strong: ["Strong", "text-green-d"], watch: ["Watch", "text-[#7d5600]"], weak: ["Weak", "text-red"], info: ["–", "text-mute"],
};

function useBank(input: ReportInput) {
  const lang = useT().lang;
  return useMemo(() => bankPack(input.months, input.sel.end, input.settings, input.assumptions ?? {}, input.companyName, input.accounts, lang, input.asOf), [input.months, input.sel.end, input.settings, input.assumptions, input.companyName, input.accounts, input.asOf, lang]);
}

const Tile = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="border-t-2 border-line pt-1.5"><div className="label">{label}</div><div className="num text-[19px]">{value}</div>{sub && <div className="text-[10.5px] text-mute">{sub}</div>}</div>
);

/** Bank Readiness: the measures a credit analyst checks, the questions to expect and the discussion memo. */
export function ReportBank({ input, head }: { input: ReportInput; head: (title: string, label: string) => React.ReactNode }) {
  const T = useT();
  const t = T.d.rep.doc;
  const band = (b: Band) => (T.lang === "ar" && b !== "info" ? T.d.bank.band[b] : BAND[b][0]);
  const p = useBank(input);
  const cur = input.settings.currency;
  const { assessment: a, pf } = p;
  const r = (k: string) => a.ratios.find((x) => x.key === k)!;
  const saved = readMemo(input.commentary.bank, "bank", input.assumptions ?? {});
  // A memo written before the request or loan terms changed no longer matches the figures: the automatic memo is printed instead.
  const own = saved.text && !saved.stale ? saved.text : null;
  const memo = own ?? p.memo;
  return (
    <>
      {head(T.d.rep.secs.bank, p.basis.label)}
      <div className="mb-4 grid grid-cols-4 gap-4">
        <Tile label={T.d.bank.dscr} value={formatBankValue(r("dscr"), cur, T.lang)} sub={t.guideMore(BANK_LIMITS.dscr)} />
        <Tile label={T.d.bank.debtEbitda} value={formatBankValue(r("debt_ebitda"), cur, T.lang)} sub={t.guideLess(BANK_LIMITS.debtEbitda)} />
        <Tile label={t.roomToBorrow} value={a.capacity.headroom === null ? "–" : money(a.capacity.headroom, cur, true)} sub={a.capacity.rate === null ? t.noRate : t.atRate(pct(a.capacity.rate, 1), a.capacity.tenor)} />
        <Tile label={t.request} value={pf ? money(pf.amount, cur, true) : "–"} sub={pf ? (pf.fits === true ? t.fits : pf.fits === false ? t.beyond : "") : t.noneEntered} />
      </div>
      <div>
        <table className="tbl text-[10.5px]" data-testid="report-bank-ratios">
          <thead><tr><th>{t.measure}</th><th>{t.value}</th><th>{t.guide}</th><th></th></tr></thead>
          <tbody>{a.ratios.filter((x) => x.band !== "info").map((x) => (
            <tr key={x.key}><td>{x.name}{x.estimate ? "*" : ""}</td><td>{formatBankValue(x, cur, T.lang)}</td><td className="text-mute">{x.guide}</td><td className={cn("font-medium", BAND[x.band][1])}>{band(x.band)}</td></tr>
          ))}</tbody>
        </table>
        <div className="rcomment"><div className="label mb-1">{own ? t.memo : t.memoAuto}</div><MemoText text={memo} className="!space-y-2 !text-[11px] [&>div:not(:first-child)]:break-inside-avoid columns-2 gap-6" /></div>
      </div>
      {a.principalEstimated && a.principal12m > 0 && <p className="mt-2 text-[10px] text-mute">{t.estimated(a.capacity.tenor)}</p>}
      <p className="mt-3 text-[10px] text-mute">{t.guidesNote}</p>
    </>
  );
}

/** Three-year trend, stress test and the request tested. */
export function ReportBankOutlook({ input, head }: { input: ReportInput; head: (title: string, label: string) => React.ReactNode }) {
  const T = useT();
  const t = T.d.rep.doc;
  const p = useBank(input);
  const cur = input.settings.currency;
  return (
    <>
      {head(t.bankOutlook, p.basis.label)}
      <div className="label mb-1">{t.threeYear}</div>
      <TrendTable trend={p.trend} cur={cur} small />
      {p.trend.years.length < 3 && <p className="mt-1 text-[10px] text-mute">{t.years(p.trend.years.length)}</p>}
      <div className="label mb-1 mt-5">{t.stress}</div>
      <p className="mb-2 text-[11.5px]">{breakingPoints(p.stress, T.d.bank)}</p>
      <StressTable stress={p.stress} cur={cur} small />
      {p.pf && <><div className="label mb-1 mt-5">{t.theRequest}</div><ProFormaTable pf={p.pf} a={p.assessment} cur={cur} small /></>}
    </>
  );
}

/** Reported against real profit: inflation bridge, collection and the dollar view. */
export function ReportRealProfit({ input, head }: { input: ReportInput; head: (title: string, label: string) => React.ReactNode }) {
  const T = useT();
  const t = T.d.rep.doc;
  const lang = T.lang;
  const cur = input.settings.currency;
  const { basis, x } = useMemo(() => {
    const basis = twelveMonths(input.months, input.sel.end, input.settings.fyStartMonth, input.asOf, input.settings.vatRate);
    return { basis, x: realProfit(basis, input.assumptions ?? {}, cur, input.settings.targets?.ar_days ?? 45, lang) };
  }, [input.months, input.sel.end, input.settings, input.assumptions, input.asOf, cur, lang]);
  const inf = x.inflation;
  const rows: WaterfallRow[] = inf ? [
    { label: t.reported, sign: "TOTAL", value: x.reported },
    ...inf.steps.map((s): WaterfallRow => ({ label: s.label, sign: s.value >= 0 ? "ADD" : "LESS", value: s.value })),
    { label: t.realToday, sign: "TOTAL", value: inf.real },
  ] : [];
  const as = input.assumptions ?? {};
  const col = x.collection;
  return (
    <>
      {head(T.d.rep.secs.realprofit, basis.label)}
      <div className="mb-4 grid grid-cols-4 gap-4">
        <Tile label={t.reported} value={money(x.reported, cur, true)} />
        <Tile label={t.cashOps} value={x.cashProfit === null ? "–" : money(x.cashProfit, cur, true)} />
        <Tile label={t.real} value={inf ? money(inf.real, cur, true) : "–"} sub={inf ? t.afterInf(pct(inf.periodRate, 1)) : t.noInf} />
        <Tile label={t.usd} value={x.fx ? money(x.fx.reportedUsd, "USD", true) : "–"} sub={x.fx ? t.pound(x.fx.devaluation >= 0, pct(Math.abs(x.fx.poundChange), 1)) : t.noFx} />
      </div>
      {inf ? <CashWaterfall rows={rows} cur={cur} /> : <p className="text-mute">{t.enterInf}</p>}
      <div className="mt-5 grid grid-cols-2 gap-6 text-[11.5px]">
        <table className="tbl"><tbody>
          <tr><td>{t.invoiced}</td><td>{money(col.revenue, cur)}</td></tr>
          <tr><td>{t.collected}</td><td>{col.collected === null ? "–" : money(col.collected, cur)}</td></tr>
          <tr><td>{t.rate}</td><td>{col.rate === null ? "–" : pct(col.rate, 1)}</td></tr>
          <tr><td>{t.custDays}</td><td>{col.dso === null ? "–" : Math.round(col.dso)}</td></tr>
          {col.creditCost !== null && <tr><td>{t.creditCost}</td><td>{money(col.creditCost, cur)}</td></tr>}
        </tbody></table>
        <table className="tbl"><tbody>
          {inf && <><tr><td>{t.roe}</td><td>{inf.roe === null ? "–" : pct(inf.roe, 1)}</td></tr><tr><td>{t.afterInfl}</td><td>{inf.realRoe === null ? "–" : pct(inf.realRoe, 1)}</td></tr></>}
          {x.fx && <><tr><td>{t.eqStart}</td><td>{x.fx.equityStartUsd === null ? "–" : money(x.fx.equityStartUsd, "USD")}</td></tr><tr><td>{t.eqEnd}</td><td>{money(x.fx.equityEndUsd, "USD")}</td></tr></>}
        </tbody></table>
      </div>
      <div className="rcomment whitespace-pre-line">{(() => { const r = readMemo(input.commentary.realprofit, "realprofit", input.assumptions ?? {}); return r.text && !r.stale ? r.text : realProfitSummary(x, cur, lang); })()}</div>
      <p className="mt-2 text-[10px] text-mute">
        {t.ratesUsed(String(as.inflation ?? "–"), String(as.fxStart ?? "–"), String(as.fxEnd ?? "–"), String(as.importShare ?? 0), String(as.assetAge ?? "–"), !!as.example)}
      </p>
    </>
  );
}

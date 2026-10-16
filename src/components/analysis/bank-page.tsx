"use client";
import Link from "next/link";
import { useMemo } from "react";
import { AlertTriangle, ChevronDown, FileUp, Landmark } from "lucide-react";
import { BANK_CHECKLIST, BANK_CHECKLIST_AR, BANK_LIMITS, bankPack, formatBankValue, money, pct, type Band, type BankGroup } from "@/lib/engine";
import { useT } from "@/lib/i18n/use-t";
import { useCompany } from "@/lib/company/context";
import { usePeriod } from "@/lib/company/use-period";
import { PageHeader } from "@/components/shell/page-header";
import { PeriodPicker } from "@/components/shell/period-picker";
import { cn } from "@/lib/cn";
import { AssumptionsPanel, fmtX, useAssumptions } from "./assumptions";
import { breakingPoints, ProFormaTable, StressTable, TrendTable } from "./bank-tables";
import { Tile } from "./common";
import { MemoBox } from "./memo-box";
import { ReadinessCard } from "@/components/setup/readiness-view";

const BAND: Record<Band, string> = {
  strong: "bg-green-bg text-green-d",
  watch: "bg-amber/20 text-[#9a6b00]",
  weak: "bg-red-bg text-red",
  info: "bg-band text-mute",
};
const GROUPS: BankGroup[] = ["Repayment", "Liquidity", "Capital", "Performance", "Working capital"];

export function BandChip({ band }: { band: Band }) {
  const { d } = useT();
  return <span className={cn("inline-block rounded px-1.5 py-0.5 text-[11px] font-medium", BAND[band])}>{d.bank.band[band]}</span>;
}

const H2 = ({ children, id }: { children: React.ReactNode; id?: string }) => <h2 id={id} className="mb-1 mt-12 text-xl font-light">{children}</h2>;

export function BankPage() {
  const c = useCompany();
  const { sel } = usePeriod();
  const cur = c.settings.currency;
  const { a, setA, saved } = useAssumptions();
  const { lang, d: { bank: t }, pl } = useT();
  const pack = useMemo(() => (sel.end ? bankPack(c.months, sel.end, c.settings, a, c.name, c.accounts, lang, c.asOf) : null), [c.months, sel.end, c.settings, a, c.name, c.accounts, lang, c.asOf]);
  if (!pack) return null;
  const { basis, assessment: res, trend, stress, pf } = pack;
  const r = (k: string) => res.ratios.find((x) => x.key === k)!;
  const cap = res.capacity;
  return (
    <>
      <PageHeader title={t.title} right={<PeriodPicker />}>
        <p className="text-sm text-mute" data-testid="bank-basis">{t.basis[0]}<b className="text-ink">{pl(basis.label)}</b>{basis.annualColumn ? t.annual : basis.covered < 12 ? t.scaled : ""}{t.basis[1]}</p>
      </PageHeader>
      <ReadinessCard sector="banking" />

      <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="flex items-center gap-1.5"><BandChip band="strong" /> {res.counts.strong}</span>
        <span className="flex items-center gap-1.5"><BandChip band="watch" /> {res.counts.watch}</span>
        <span className="flex items-center gap-1.5"><BandChip band="weak" /> {res.counts.weak}</span>
        <Link href={`${c.basePath}/settings/source-data`} className="ms-auto inline-flex items-center gap-1.5 text-brand-d hover:underline"><FileUp className="h-4 w-4" />{t.uploadAudited}</Link>
      </div>

      <div className="mb-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label={t.dscr} value={fmtX(r("dscr").value)} sub={<><BandChip band={r("dscr").band} /> <span className="text-mute">{t.target(`${BANK_LIMITS.dscr}x`)}</span></>} testId="tile-dscr" />
        <Tile label={t.debtEbitda} value={fmtX(r("debt_ebitda").value)} sub={<><BandChip band={r("debt_ebitda").band} /> <span className="text-mute">{t.targetOrLess(`${BANK_LIMITS.debtEbitda}x`)}</span></>} />
        <Tile label={t.room} value={cap.headroom === null ? "–" : money(cap.headroom, cur, true)} sub={<span className="text-mute">{cap.rate === null ? t.enterRate : t.atRate(pct(cap.rate, 1), cap.tenor)}</span>} testId="tile-headroom" />
        <Tile label={t.request} value={pf ? money(pf.amount, cur, true) : "–"} testId="tile-request"
          sub={pf ? <span className={pf.fits === true ? "text-green-d" : pf.fits === false ? "text-red" : "text-mute"}>{pf.fits === true ? t.fits : pf.fits === false ? t.beyond : pf.type === "lc_guarantee" ? t.nonCash : t.enterRateShort}</span> : <a href="#request" className="text-brand-d hover:underline">{t.enterAmount}</a>} />
      </div>

      <MemoBox section="bank" title={t.memoTitle} fallback={pack.memo} testId="bank-memo" />

      <H2 id="request">{t.request}</H2>
      <p className="mb-4 text-sm text-mute">{t.requestText}</p>
      <div className="grid gap-6 lg:grid-cols-2">
        <AssumptionsPanel title={t.requestPanel} columns={2} fields={["requestAmount", "requestType", "requestPurpose", "rate", "tenor", "principal12m"]} a={a} setA={setA} saved={saved} />
        <div className="space-y-5">
          {pf ? <ProFormaTable pf={pf} a={res} cur={cur} /> : <p className="rounded bg-band px-4 py-3 text-sm">{t.enterAmountText}</p>}
          <div className="text-[13px]" data-testid="capacity">
            <div className="label mb-1">{t.roomH}</div>
            <table className="tbl"><tbody>
              <tr className="row"><td>{t.cashForDebt}</td><td>{money(cap.cashForDebt, cur)}</td></tr>
              <tr className="row"><td>{t.supports(cap.targetDscr)}</td><td>{money(cap.maxService, cur)}</td></tr>
              <tr className="row"><td>{t.lessToday}{res.principalEstimated ? t.repEstimated : ""}</td><td>{money(-cap.existingService, cur)}</td></tr>
              <tr className="row"><td>{t.byDscr}{cap.rate !== null ? ` (${pct(cap.rate, 1)}${cap.rateSource === "implied" ? t.yourAvg : ""}${lang === "ar" ? "، " : ", "}${t.years(cap.tenor)})` : ""}</td><td>{cap.byDscr === null ? t.enterRateCell : money(cap.byDscr, cur)}</td></tr>
              <tr className="row"><td>{t.byLeverage(cap.maxLeverage)}</td><td>{money(cap.byLeverage, cur)}</td></tr>
              <tr className="tot"><td>{t.roomTotal}</td><td>{cap.headroom === null ? "–" : money(cap.headroom, cur)}</td></tr>
            </tbody></table>
          </div>
        </div>
      </div>

      <H2>{t.threeYear}</H2>
      <p className="mb-4 text-sm text-mute">{t.threeYearText}</p>
      <div className="overflow-x-auto"><TrendTable trend={trend} cur={cur} /></div>
      {trend.years.length < 3 && <p className="mt-2 text-sm text-mute" data-testid="trend-note">{t.onlyYears(trend.years.length)}<Link href={`${c.basePath}/settings/source-data`} className="text-brand-d underline">{t.uploadEarlier}</Link>{t.toShow}</p>}
      {trend.years.length > 1 && <p className="mt-2 text-xs text-mute">{t.earlierEstimated}</p>}

      <H2>{t.stress}</H2>
      <p className="mb-2 text-sm text-mute">{t.stressText}</p>
      <p className="mb-4 rounded bg-brand-bg px-3 py-2 text-[13px]" data-testid="breaking-points">{breakingPoints(stress, t)}</p>
      <div className="overflow-x-auto"><StressTable stress={stress} cur={cur} /></div>
      {stress.notes.map((n) => <p key={n} className="mt-2 text-xs text-mute">{n}</p>)}

      <H2>{t.checks}</H2>
      <p className="mb-4 text-sm text-mute">{t.checksText}</p>
      <div className="space-y-8" data-testid="bank-ratios">
        {GROUPS.map((g) => (
          <div key={g}>
            <div className="mb-1 font-medium">{t.groups[g][0]}</div>
            <p className="mb-2 text-xs text-mute">{t.groups[g][1]}</p>
            <div className="divide-y divide-line border-y border-line">
              {res.ratios.filter((x) => x.group === g).map((x) => (
                <details key={x.key} className="group" data-testid={`ratio-${x.key}`}>
                  <summary className="grid cursor-pointer list-none grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-1 py-2.5 hover:bg-band sm:grid-cols-[1fr_140px_190px_70px_16px]">
                    <span>{x.name}{x.estimate && <span className="ms-1 text-xs text-[#9a6b00]">{t.estimate}</span>}</span>
                    <span className="num text-end font-medium">{formatBankValue(x, cur, lang)}</span>
                    <span className="hidden text-end text-xs text-mute sm:block">{x.guide}</span>
                    <span className="text-end sm:text-start"><BandChip band={x.band} /></span>
                    <ChevronDown className="hidden h-4 w-4 text-mute transition group-open:rotate-180 sm:block" />
                  </summary>
                  <div className="space-y-1.5 bg-band px-3 py-3 text-[13px]">
                    <p className="text-xs text-mute sm:hidden">{t.guide}: {x.guide}</p>
                    <p><b className="font-medium">{t.sees}</b> {x.banker}</p>
                    <p><b className="font-medium">{t.todo}</b> {x.advice}</p>
                    {x.estimate && <p className="text-[#9a6b00]">{x.estimate}</p>}
                    <p className="text-xs text-mute">{x.formula}</p>
                  </div>
                </details>
              ))}
            </div>
          </div>
        ))}
      </div>

      <H2>{t.questions}</H2>
      {res.flags.length ? (
        <div className="mt-3 space-y-3" data-testid="bank-flags">
          {res.flags.map((f) => (
            <div key={f.key} className={cn("rounded-md border-s-[3px] bg-band px-4 py-3 text-[13px]", f.severity === "high" ? "border-red" : "border-amber")}>
              <div className="flex items-center gap-2 font-medium"><AlertTriangle className={cn("h-4 w-4", f.severity === "high" ? "text-red" : "text-amber")} />{f.title}</div>
              <p className="mt-1 text-mute">{f.detail}</p>
              <p className="mt-1">{f.advice}</p>
            </div>
          ))}
        </div>
      ) : <p className="mt-3 text-sm text-mute">{t.noQuestions}</p>}

      <h2 className="mb-3 mt-12 flex items-center gap-2 text-xl font-light"><Landmark className="h-5 w-5 text-brand-d" strokeWidth={1.6} />{t.documents}</h2>
      <ul className="mb-6 grid gap-3 sm:grid-cols-2" data-testid="bank-checklist">
        {(lang === "ar" ? BANK_CHECKLIST_AR : BANK_CHECKLIST).map((d) => (
          <li key={d.item} className="rounded-md border border-line p-3 text-[13px]"><div className="font-medium">{d.item}</div><div className="mt-0.5 text-mute">{d.why}</div></li>
        ))}
      </ul>
      <p className="text-xs text-mute">{t.disclaimer(c.name)}</p>
    </>
  );
}

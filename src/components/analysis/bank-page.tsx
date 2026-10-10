"use client";
import Link from "next/link";
import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, FileUp, Landmark, MessageSquareQuote } from "lucide-react";
import { BANK_CHECKLIST, bankAssessment, money, pct, twelveMonths, type Band, type BankGroup, type BankRatio } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { usePeriod } from "@/lib/company/use-period";
import { PageHeader } from "@/components/shell/page-header";
import { PeriodPicker } from "@/components/shell/period-picker";
import { cn } from "@/lib/cn";
import { AssumptionsPanel, fmtX, useAssumptions } from "./assumptions";
import { Tile } from "./common";

const BAND: Record<Band, { label: string; cls: string }> = {
  strong: { label: "Strong", cls: "bg-green-bg text-green-d" },
  watch: { label: "Watch", cls: "bg-amber/20 text-[#9a6b00]" },
  weak: { label: "Weak", cls: "bg-red-bg text-red" },
  info: { label: "Context", cls: "bg-band text-mute" },
};
const GROUPS: { key: BankGroup; title: string; about: string }[] = [
  { key: "Repayment", title: "Can the business repay?", about: "The first test of any loan: cash from trading against the yearly interest and instalments." },
  { key: "Liquidity", title: "Can it meet short-term bills?", about: "Short-term assets against what falls due within a year, and whether long-term assets have long-term funding." },
  { key: "Capital", title: "How much do the owners carry?", about: "Owners' equity is the cushion that protects the lender." },
  { key: "Performance", title: "Is the business earning, in cash?", about: "Growth, margins and how much profit turns into cash." },
  { key: "Working capital", title: "How long is cash tied up?", about: "Days to collect from customers, sell stock and pay suppliers: the basis for a working-capital facility." },
];

export function BandChip({ band }: { band: Band }) {
  return <span className={cn("inline-block rounded px-1.5 py-0.5 text-[11px] font-medium", BAND[band].cls)}>{BAND[band].label}</span>;
}

function fmt(r: BankRatio, cur: string) {
  if (r.value === null) return "n/a";
  if (r.unit === "x") return fmtX(r.value);
  if (r.unit === "%") return pct(r.value, 1);
  if (r.unit === "days") return `${Math.round(r.value)} days`;
  return money(r.value, cur);
}

export function BankPage() {
  const c = useCompany();
  const { sel } = usePeriod();
  const cur = c.settings.currency;
  const { a, setA, saved } = useAssumptions();
  const basis = useMemo(() => (sel.end ? twelveMonths(c.months, sel.end, c.settings.fyStartMonth) : null), [c.months, sel.end, c.settings.fyStartMonth]);
  const res = useMemo(() => (basis ? bankAssessment(basis, { rate: a.rate, tenor: a.tenor, principal12m: a.principal12m, inflation: a.inflation }, cur) : null), [basis, a.rate, a.tenor, a.principal12m, a.inflation, cur]);
  if (!basis || !res) return null;
  const r = (k: string) => res.ratios.find((x) => x.key === k)!;
  const cap = res.capacity;
  const prepare = [...res.weaknesses.map((w) => ({ title: w.name, text: w.advice })), ...res.flags.map((f) => ({ title: f.title, text: f.advice }))];
  return (
    <>
      <PageHeader title="Bank Readiness" right={<PeriodPicker />}>
        <p className="text-sm text-mute" data-testid="bank-basis">How a credit analyst reads these accounts, on the <b className="text-ink">{basis.label}</b>{basis.annualColumn ? " (annual statements)" : basis.covered < 12 ? ", scaled to a year" : ""}.</p>
      </PageHeader>

      <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="flex items-center gap-1.5"><BandChip band="strong" /> {res.counts.strong}</span>
        <span className="flex items-center gap-1.5"><BandChip band="watch" /> {res.counts.watch}</span>
        <span className="flex items-center gap-1.5"><BandChip band="weak" /> {res.counts.weak}</span>
        <Link href={`${c.basePath}/settings/source-data`} className="ml-auto inline-flex items-center gap-1.5 text-brand-d hover:underline"><FileUp className="h-4 w-4" />Upload audited statements</Link>
      </div>

      <div className="mb-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Debt service cover" value={fmtX(r("dscr").value)} sub={<><BandChip band={r("dscr").band} /> <span className="text-mute">target 1.25x</span></>} testId="tile-dscr" />
        <Tile label="Debt to EBITDA" value={fmtX(r("debt_ebitda").value)} sub={<><BandChip band={r("debt_ebitda").band} /> <span className="text-mute">target 3x or less</span></>} />
        <Tile label="Room to borrow (estimate)" value={cap.headroom === null ? "–" : money(cap.headroom, cur, true)} sub={<span className="text-mute">{cap.rate === null ? "enter a borrowing rate below" : `at ${pct(cap.rate, 1)} over ${cap.tenor} years`}</span>} testId="tile-headroom" />
        <Tile label="Questions to prepare for" value={String(res.flags.length)} sub={<span className="text-mute">{res.flags.filter((f) => f.severity === "high").length} serious</span>} />
      </div>

      <section className="mb-10 grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg bg-green-bg/50 p-4">
          <h2 className="mb-2 flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4 text-green-d" />Lead with these</h2>
          {res.strengths.length ? <ul className="space-y-2 text-[13px]">{res.strengths.slice(0, 5).map((s) => <li key={s.key}><b className="font-medium">{s.name}: {fmt(s, cur)}.</b> {s.banker}</li>)}</ul>
            : <p className="text-[13px] text-mute">No measure is in the strong range yet. Work on the points opposite before applying.</p>}
        </div>
        <div className="rounded-lg bg-red-bg/50 p-4">
          <h2 className="mb-2 flex items-center gap-2 font-medium"><MessageSquareQuote className="h-4 w-4 text-red" />Prepare answers for these</h2>
          {prepare.length ? <ul className="space-y-2 text-[13px]">{prepare.slice(0, 6).map((p) => <li key={p.title}><b className="font-medium">{p.title}.</b> {p.text}</li>)}</ul>
            : <p className="text-[13px] text-mute">No weak measures or serious questions. Keep the file tidy and up to date.</p>}
        </div>
      </section>

      <h2 className="mb-1 text-xl font-light">What the bank checks</h2>
      <p className="mb-4 text-sm text-mute">Ranges are common lender rules of thumb for small and mid-sized companies. Each bank sets its own limits, and collateral, sector and the owners&apos; record also count. Open a row for what it means and what to say.</p>
      <div className="mb-10 space-y-8" data-testid="bank-ratios">
        {GROUPS.map((g) => (
          <div key={g.key}>
            <div className="mb-1 font-medium">{g.title}</div>
            <p className="mb-2 text-xs text-mute">{g.about}</p>
            <div className="divide-y divide-line border-y border-line">
              {res.ratios.filter((x) => x.group === g.key).map((x) => (
                <details key={x.key} className="group" data-testid={`ratio-${x.key}`}>
                  <summary className="grid cursor-pointer list-none grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-1 py-2.5 hover:bg-band sm:grid-cols-[1fr_140px_190px_70px_16px]">
                    <span>{x.name}{x.estimate && <span className="ml-1 text-xs text-[#9a6b00]">(estimate)</span>}</span>
                    <span className="num text-right font-medium">{fmt(x, cur)}</span>
                    <span className="hidden text-right text-xs text-mute sm:block">{x.guide}</span>
                    <span className="text-right sm:text-left"><BandChip band={x.band} /></span>
                    <ChevronDown className="hidden h-4 w-4 text-mute transition group-open:rotate-180 sm:block" />
                  </summary>
                  <div className="space-y-1.5 bg-band px-3 py-3 text-[13px]">
                    <p className="text-xs text-mute sm:hidden">Guide: {x.guide}</p>
                    <p><b className="font-medium">What the bank sees.</b> {x.banker}</p>
                    <p><b className="font-medium">What to do.</b> {x.advice}</p>
                    {x.estimate && <p className="text-[#9a6b00]">{x.estimate}</p>}
                    <p className="text-xs text-mute">{x.formula}</p>
                  </div>
                </details>
              ))}
            </div>
          </div>
        ))}
      </div>

      <h2 className="mb-3 text-xl font-light">Questions the bank will ask</h2>
      {res.flags.length ? (
        <div className="mb-10 space-y-3" data-testid="bank-flags">
          {res.flags.map((f) => (
            <div key={f.key} className={cn("rounded-md border-l-[3px] bg-band px-4 py-3 text-[13px]", f.severity === "high" ? "border-red" : "border-amber")}>
              <div className="flex items-center gap-2 font-medium"><AlertTriangle className={cn("h-4 w-4", f.severity === "high" ? "text-red" : "text-amber")} />{f.title}</div>
              <p className="mt-1 text-mute">{f.detail}</p>
              <p className="mt-1">{f.advice}</p>
            </div>
          ))}
        </div>
      ) : <p className="mb-10 text-sm text-mute">Nothing in these figures that an analyst would usually query.</p>}

      <h2 className="mb-1 text-xl font-light">How much more could you borrow?</h2>
      <p className="mb-4 text-sm text-mute">A first estimate of the extra loan these figures support, by the two tests banks apply first. Your bank&apos;s own terms decide.</p>
      <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
        <AssumptionsPanel title="Loan terms" fields={["rate", "tenor", "principal12m"]} a={a} setA={setA} saved={saved} />
        <div className="rounded-lg border border-line p-4 text-[13px]" data-testid="capacity">
          <table className="tbl"><tbody>
            <tr className="row"><td>Cash for debt each year (EBITDA − tax)</td><td>{money(cap.cashForDebt, cur)}</td></tr>
            <tr className="row"><td>Payments it supports at {cap.targetDscr}x cover</td><td>{money(cap.maxService, cur)}</td></tr>
            <tr className="row"><td>Less today&apos;s interest and repayments{res.principalEstimated ? " (repayments estimated)" : ""}</td><td>{money(-cap.existingService, cur)}</td></tr>
            <tr className="row"><td>Extra loan by debt-service cover{cap.rate !== null ? ` (${pct(cap.rate, 1)}${cap.rateSource === "implied" ? ", your current average rate" : ""}, ${cap.tenor} years)` : ""}</td><td>{cap.byDscr === null ? "enter a rate" : money(cap.byDscr, cur)}</td></tr>
            <tr className="row"><td>Extra loan keeping debt at {cap.maxLeverage}x EBITDA</td><td>{money(cap.byLeverage, cur)}</td></tr>
            <tr className="tot"><td>Estimated room to borrow (the lower)</td><td>{cap.headroom === null ? "–" : money(cap.headroom, cur)}</td></tr>
          </tbody></table>
          <p className="mt-3 text-xs text-mute">Overdrafts and revolving lines are assumed renewed. Security, existing limits on your iScore report and the bank&apos;s sector appetite can lower this.</p>
        </div>
      </div>

      <h2 className="mb-3 mt-10 flex items-center gap-2 text-xl font-light"><Landmark className="h-5 w-5 text-brand-d" strokeWidth={1.6} />Documents to prepare</h2>
      <ul className="mb-6 grid gap-3 sm:grid-cols-2" data-testid="bank-checklist">
        {BANK_CHECKLIST.map((d) => (
          <li key={d.item} className="rounded-md border border-line p-3 text-[13px]"><div className="font-medium">{d.item}</div><div className="mt-0.5 text-mute">{d.why}</div></li>
        ))}
      </ul>
      <p className="text-xs text-mute">This page applies common credit-analysis tests to the figures in {c.name}&apos;s books. It is not a credit decision or financial advice; each bank applies its own policy.</p>
    </>
  );
}

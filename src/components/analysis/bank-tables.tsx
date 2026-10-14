import { BANK_LIMITS, money, pct, REQUEST_LABEL, REQUEST_LABEL_AR, type BankAssessment, type ProForma, type StressResult, type TrendRow, type YearTrend } from "@/lib/engine";
import { cn } from "@/lib/cn";
import { dict, type Dict } from "@/lib/i18n";
import { useT } from "@/lib/i18n/use-t";

type BankWords = Dict["bank"];
const x2 = (v: number | null, na = "n/a") => (v === null ? na : `${v.toFixed(2)}x`);

function cell(r: TrendRow, v: number | null, cur: string) {
  if (v === null) return "–";
  if (r.unit === "cur") return money(v, cur, true);
  if (r.unit === "%") return pct(v, 1);
  if (r.unit === "days") return `${Math.round(v)}`;
  return x2(v);
}

/** Up to three years side by side, with whether the latest year moved the right way. */
export function TrendTable({ trend, cur, small }: { trend: YearTrend; cur: string; small?: boolean }) {
  const { d: { bank: t } } = useT();
  return (
    <table className={cn("tbl", small && "text-[11.5px]")} data-testid="trend-table">
      <thead><tr><th>{t.measure}</th>{trend.years.map((y) => <th key={y.end}>{y.label.replace(t.yearPrefix, "")}</th>)}<th>{t.latestYear}</th></tr></thead>
      <tbody>
        {trend.rows.map((r) => (
          <tr key={r.key} className="row">
            <td>{r.name}{r.unit === "days" ? t.days : ""}</td>
            {r.values.map((v, i) => <td key={i}>{cell(r, v, cur)}</td>)}
            <td className={r.direction === "better" ? "text-green-d" : r.direction === "worse" ? "text-red" : "text-mute"}>
              {r.direction === "better" ? t.better : r.direction === "worse" ? t.worse : r.direction === "flat" ? t.steady : "–"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const STRESS_BAND = {
  pass: "bg-green-bg text-green-d",
  tight: "bg-amber/20 text-[#9a6b00]",
  fail: "bg-red-bg text-red",
  na: "bg-band text-mute",
} as const;

export function StressTable({ stress, cur, small }: { stress: StressResult; cur: string; small?: boolean }) {
  const { d: { bank: t } } = useT();
  return (
    <table className={cn("tbl", small && "text-[11.5px]")} data-testid="stress-table">
      <thead><tr><th>{t.scenario}</th><th>{t.ebitda}</th><th>{t.interest}</th><th>{t.cover}</th><th>{t.debtEbitdaCol}</th><th>{t.result}</th></tr></thead>
      <tbody>
        {stress.scenarios.map((s) => (
          <tr key={s.key} className={cn("row", s.key === "base" && "font-medium")}>
            <td><div>{s.name}</div>{!small && <div className="text-xs font-normal text-mute">{s.detail}{s.extraCash ? t.extraCash(money(s.extraCash, cur, true)) : ""}</div>}</td>
            <td>{money(s.ebitda, cur, true)}</td>
            <td>{money(s.interest, cur, true)}</td>
            <td>{x2(s.dscr, t.na)}</td>
            <td>{x2(s.debtEbitda, t.na)}</td>
            <td><span className={cn("inline-block rounded px-1.5 py-0.5 text-[11px] font-medium", STRESS_BAND[s.band])}>{t.stressBand[s.band]}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function breakingPoints(stress: StressResult, t: BankWords = dict("en").bank): string {
  const parts: string[] = [];
  if (stress.maxSalesFall !== null) parts.push(stress.maxSalesFall <= 0 ? t.bpShort : stress.maxSalesFall >= 100 ? t.bpNoSales : t.bpFall(Math.round(stress.maxSalesFall)));
  if (stress.maxRateRise !== null && stress.maxSalesFall !== null && stress.maxSalesFall > 0) parts.push(stress.maxRateRise >= 100 ? t.bpRate100 : t.bpRate(stress.maxRateRise.toFixed(1)));
  return parts.length ? parts.join(t.bpJoin) + "." : t.bpNone;
}

/** The request tested: cover, leverage and interest cover before and after, and the verdict. */
export function ProFormaTable({ pf, a, cur, small }: { pf: ProForma; a: BankAssessment; cur: string; small?: boolean }) {
  const { lang, d: { bank: t } } = useT();
  const verdict = pf.type === "lc_guarantee" ? t.pfLc
    : pf.dscr === null ? t.pfRate
    : pf.fits ? t.pfFits(pf.dscr.toFixed(2), pf.debtEbitda?.toFixed(1) ?? "–")
    : `${t.pfBeyond}${pf.excess ? t.pfExcess(money(pf.excess, cur)) : ""}.${pf.tenorNeeded ? t.pfTenor(pf.tenorNeeded, a.capacity.targetDscr) : pf.type === "term_loan" || pf.type === "other" ? t.pfNoTenor : ""}`;
  return (
    <div data-testid="proforma">
      <p className={cn("mb-2 rounded px-3 py-2", small ? "text-[11.5px]" : "text-[13px]", pf.fits === true ? "bg-green-bg text-green-d" : pf.fits === false ? "bg-red-bg text-red" : "bg-band")}>
        <b>{money(pf.amount, cur)} · {(lang === "ar" ? REQUEST_LABEL_AR : REQUEST_LABEL)[pf.type]}.</b> {verdict}
      </p>
      <table className={cn("tbl", small && "text-[11.5px]")}>
        <thead><tr><th>{t.measure}</th><th>{t.today}</th><th>{t.withNew}</th><th>{t.guideCol}</th></tr></thead>
        <tbody>
          <tr className="row"><td>{t.paymentAdded}</td><td>–</td><td>{pf.payment === null ? t.na : money(pf.payment, cur)}</td><td>{pf.type === "working_capital" ? t.interestOnly : pf.type === "lc_guarantee" ? t.none : t.yearsAt(pf.tenor, pf.rate !== null ? pct(pf.rate, 1) : null)}</td></tr>
          <tr className="row"><td>{t.dscr}</td><td>{x2(pf.dscrBefore, t.na)}</td><td>{x2(pf.dscr, t.na)}</td><td>{t.orMore(BANK_LIMITS.dscr)}</td></tr>
          <tr className="row"><td>{t.debtEbitda}</td><td>{x2(pf.debtEbitdaBefore, t.na)}</td><td>{x2(pf.debtEbitda, t.na)}</td><td>{t.orLess(BANK_LIMITS.debtEbitda)}</td></tr>
          <tr className="row"><td>{t.intCover}</td><td>{x2(pf.icrBefore, t.na)}</td><td>{x2(pf.icr, t.na)}</td><td>{t.orMore(BANK_LIMITS.intCover)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

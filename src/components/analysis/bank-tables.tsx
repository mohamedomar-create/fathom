import { money, pct, REQUEST_LABEL, type BankAssessment, type ProForma, type StressResult, type TrendRow, type YearTrend } from "@/lib/engine";
import { cn } from "@/lib/cn";

const x2 = (v: number | null) => (v === null ? "n/a" : `${v.toFixed(2)}x`);

function cell(r: TrendRow, v: number | null, cur: string) {
  if (v === null) return "–";
  if (r.unit === "cur") return money(v, cur, true);
  if (r.unit === "%") return pct(v, 1);
  if (r.unit === "days") return `${Math.round(v)}`;
  return x2(v);
}

/** Up to three years side by side, with whether the latest year moved the right way. */
export function TrendTable({ trend, cur, small }: { trend: YearTrend; cur: string; small?: boolean }) {
  return (
    <table className={cn("tbl", small && "text-[11.5px]")} data-testid="trend-table">
      <thead><tr><th>Measure</th>{trend.years.map((y) => <th key={y.end}>{y.label.replace("12 months to ", "")}</th>)}<th>Latest year</th></tr></thead>
      <tbody>
        {trend.rows.map((r) => (
          <tr key={r.key} className="row">
            <td>{r.name}{r.unit === "days" ? " (days)" : ""}</td>
            {r.values.map((v, i) => <td key={i}>{cell(r, v, cur)}</td>)}
            <td className={r.direction === "better" ? "text-green-d" : r.direction === "worse" ? "text-red" : "text-mute"}>
              {r.direction === "better" ? "▲ better" : r.direction === "worse" ? "▼ worse" : r.direction === "flat" ? "steady" : "–"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const STRESS_BAND = {
  pass: { label: "Covered", cls: "bg-green-bg text-green-d" },
  tight: { label: "Tight", cls: "bg-amber/20 text-[#9a6b00]" },
  fail: { label: "Not covered", cls: "bg-red-bg text-red" },
  na: { label: "No debt", cls: "bg-band text-mute" },
} as const;

export function StressTable({ stress, cur, small }: { stress: StressResult; cur: string; small?: boolean }) {
  return (
    <table className={cn("tbl", small && "text-[11.5px]")} data-testid="stress-table">
      <thead><tr><th>Scenario</th><th>EBITDA</th><th>Interest</th><th>Cover</th><th>Debt / EBITDA</th><th>Result</th></tr></thead>
      <tbody>
        {stress.scenarios.map((s) => (
          <tr key={s.key} className={cn("row", s.key === "base" && "font-medium")}>
            <td><div>{s.name}</div>{!small && <div className="text-xs font-normal text-mute">{s.detail}{s.extraCash ? ` Extra cash tied up: ${money(s.extraCash, cur, true)}.` : ""}</div>}</td>
            <td>{money(s.ebitda, cur, true)}</td>
            <td>{money(s.interest, cur, true)}</td>
            <td>{x2(s.dscr)}</td>
            <td>{x2(s.debtEbitda)}</td>
            <td><span className={cn("inline-block rounded px-1.5 py-0.5 text-[11px] font-medium", STRESS_BAND[s.band].cls)}>{STRESS_BAND[s.band].label}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function breakingPoints(stress: StressResult): string {
  const parts: string[] = [];
  if (stress.maxSalesFall !== null) parts.push(stress.maxSalesFall <= 0 ? "Cash already falls short of loan payments" : stress.maxSalesFall >= 100 ? "Even with no sales the payments would be covered" : `Sales can fall ${Math.round(stress.maxSalesFall)}% before cash stops covering loan payments`);
  if (stress.maxRateRise !== null && stress.maxSalesFall !== null && stress.maxSalesFall > 0) parts.push(stress.maxRateRise >= 100 ? "rates could rise more than 100 points" : `rates could rise ${stress.maxRateRise.toFixed(1)} points`);
  return parts.length ? parts.join("; ") + "." : "There is no debt service to stress.";
}

/** The request tested: cover, leverage and interest cover before and after, and the verdict. */
export function ProFormaTable({ pf, a, cur, small }: { pf: ProForma; a: BankAssessment; cur: string; small?: boolean }) {
  const verdict = pf.type === "lc_guarantee" ? "A non-cash facility: no repayments, so cover does not change. The bank will look at the cash margin it holds and your trading record."
    : pf.dscr === null ? "Enter the borrowing rate to test this request."
    : pf.fits ? `Fits: cover stays at ${pf.dscr.toFixed(2)}x and debt at ${pf.debtEbitda?.toFixed(1)}x EBITDA.`
    : `Beyond common limits${pf.excess ? `: about ${money(pf.excess, cur)} above the estimated room to borrow` : ""}.${pf.tenorNeeded ? ` Repaying over ${pf.tenorNeeded} years would keep cover at ${a.capacity.targetDscr}x.` : pf.type === "term_loan" || pf.type === "other" ? " No tenor brings cover to the target at this rate; consider a smaller amount or more equity." : ""}`;
  return (
    <div data-testid="proforma">
      <p className={cn("mb-2 rounded px-3 py-2", small ? "text-[11.5px]" : "text-[13px]", pf.fits === true ? "bg-green-bg text-green-d" : pf.fits === false ? "bg-red-bg text-red" : "bg-band")}>
        <b>{money(pf.amount, cur)} · {REQUEST_LABEL[pf.type]}.</b> {verdict}
      </p>
      <table className={cn("tbl", small && "text-[11.5px]")}>
        <thead><tr><th>Measure</th><th>Today</th><th>With the new facility</th><th>Guide</th></tr></thead>
        <tbody>
          <tr className="row"><td>Yearly payment added</td><td>–</td><td>{pf.payment === null ? "n/a" : money(pf.payment, cur)}</td><td>{pf.type === "working_capital" ? "interest only" : pf.type === "lc_guarantee" ? "none" : `${pf.tenor} years${pf.rate !== null ? ` at ${pct(pf.rate, 1)}` : ""}`}</td></tr>
          <tr className="row"><td>Debt service cover</td><td>{x2(pf.dscrBefore)}</td><td>{x2(pf.dscr)}</td><td>1.25x or more</td></tr>
          <tr className="row"><td>Debt to EBITDA</td><td>{x2(pf.debtEbitdaBefore)}</td><td>{x2(pf.debtEbitda)}</td><td>3x or less</td></tr>
          <tr className="row"><td>Interest cover</td><td>{x2(pf.icrBefore)}</td><td>{x2(pf.icr)}</td><td>2.5x or more</td></tr>
        </tbody>
      </table>
    </div>
  );
}

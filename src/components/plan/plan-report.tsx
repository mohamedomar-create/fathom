"use client";
import { pct } from "@/lib/engine/format";
import { byYear, loanPayment, projectMonths, sensitivity, sourcesAndUses, type BusinessPlan } from "@/lib/engine/plan";
import { ColumnChart } from "@/components/charts/column-chart";
import { Bridge } from "@/components/viz/bridge";
import { ShareBar } from "@/components/viz/share-bar";
import { Tornado } from "@/components/viz/tornado";
import { ramp } from "@/components/viz/palette";
import { StaticCharts } from "@/components/charts/static";
import { BS, CF, PL, SCENARIOS, downloadPlan, usePlanMath } from "./plan-model";
import { cm, usePlanMonth, usePlanT, wm } from "./plan-ui";
import { PlanCheckList, StatementTable } from "./plan-views";
import type { SetPlan } from "./plan-inputs";

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid-page border-t border-line pt-5">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-d text-sm text-white">{n}</span>{title}</h2>
      {children}
    </section>
  );
}

/** The feasibility study: numbered sections laid out the way Egyptian banks ask for them, ready to print or save as PDF. */
export function ReportTab({ p, set, cur, company, readOnly }: { p: BusinessPlan; set: SetPlan; cur: string; company: string; readOnly: boolean }) {
  const { t, lang } = usePlanT();
  const pm = usePlanMonth();
  const { months, years, ind, checks, ratios } = usePlanMath(p, "base");
  const labels = years.map((y) => y.label);
  const su = sourcesAndUses(p, months);
  const y1 = years[0];
  const cases = SCENARIOS.map((s) => ({ s, years: byYear(projectMonths(p, s.id)) }));
  const tor = sensitivity(p, "npv", 0.1);
  const today = new Date().toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { day: "numeric", month: "long", year: "numeric" });
  const text = (k: "summary" | "market", label: string, ph: string) => (
    <label className="block text-[13px]"><span className="mb-1 block font-medium">{label}</span>
      <textarea value={p[k] ?? ""} maxLength={4000} disabled={readOnly} rows={4} placeholder={ph} onChange={(e) => set({ [k]: e.target.value } as Partial<BusinessPlan>)}
        className="w-full rounded border border-line bg-white px-3 py-2 focus:border-brand focus:outline-none disabled:bg-band" data-testid={`plan-${k}`} /></label>
  );
  let n = 0;
  return (
    <div className="space-y-4" data-testid="plan-report">
      <section className="no-print rounded-xl border border-line bg-white p-4">
        <h3 className="t-card mb-2">{t("The story behind the numbers")}</h3>
        <div className="grid gap-3 md:grid-cols-2">{text("summary", t("The company"), t("What the company does, for whom, and what this plan is for."))}{text("market", t("The market"), t("Who buys, how big the market is, who else sells to it."))}</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => downloadPlan(p, (en) => t(en))} className="rounded border border-line px-3 py-1.5 text-[13px] hover:border-brand">{t("Excel (CSV)")}</button>
          <button type="button" onClick={() => window.print()} className="rounded bg-brand-d px-3 py-1.5 text-[13px] font-medium text-white" data-testid="plan-print">{t("Print / save as PDF")}</button>
        </div>
      </section>
      <StaticCharts.Provider value={true}>
        <article className="print-doc space-y-6 rounded-xl border border-line bg-white p-6 sm:p-8" data-testid="plan-report-doc">
          <header className="-m-6 mb-2 rounded-t-xl bg-gradient-to-br from-[#0b3b3c] to-[#0b6e70] p-6 text-white sm:-m-8 sm:mb-2 sm:p-8">
            <div className="text-[12px] uppercase tracking-widest opacity-80">{company}</div>
            <h1 className="mt-1 text-2xl font-semibold">{p.name}</h1>
            <p className="mt-1 text-sm opacity-90">{t("A feasibility study for {from}–{to}", { from: labels[0], to: labels.at(-1)! })} · {today}</p>
          </header>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[[t("Sales in the last year"), cm(years.at(-1)!.revenue, cur)], [t("Net profit over the plan"), cm(years.reduce((s, y) => s + y.net, 0), cur)], [t("NPV"), cm(ind.npv, cur)],
              [t("IRR"), ind.irr === null ? "–" : pct(ind.irr, 1)], [t("Payback"), ind.payback === null ? t("Not within the plan") : ind.payback === 0 ? t("From the start") : t("{n} years", { n: ind.payback.toFixed(1) })], [ind.fundingNeeded > 0 ? t("Funding needed") : t("Lowest cash"), cm(ind.fundingNeeded > 0 ? ind.fundingNeeded : ind.minCash, cur)]].map(([l, v]) => (
              <div key={l} className="rounded-lg border border-line p-3"><div className="label">{l}</div><div className="num mt-1 text-lg font-semibold">{v}</div></div>
            ))}
          </div>
          <Section n={++n} title={t("Summary")}>
            {p.summary && <p className="mb-3 whitespace-pre-line text-[14px] leading-relaxed">{p.summary}</p>}
            <table className="mb-3 w-full text-[13px]"><tbody>
              {[[t("Sales in the first year"), wm(y1.revenue, cur)], [t("Sales in the last year"), wm(years.at(-1)!.revenue, cur)], [t("Net profit over the plan"), wm(years.reduce((s, y) => s + y.net, 0), cur)],
                [t("Investments"), wm(years.reduce((s, y) => s + y.capex, 0), cur)], [t("Funding needed"), wm(ind.fundingNeeded, cur)]].map(([l, v]) => <tr key={l} className="border-b border-line/60"><th scope="row" className="py-1 text-start font-normal text-mute">{l}</th><td className="num py-1 text-end">{v}</td></tr>)}
            </tbody></table>
            <PlanCheckList checks={checks} cur={cur} compact />
            <div className="mt-3"><ColumnChart labels={labels} cur={cur} height={220} series={[{ name: t("Sales"), values: years.map((y) => y.revenue), color: ramp(2)[0] }, { name: t("Net profit"), values: years.map((y) => y.net), color: ramp(2)[1] }]} /></div>
          </Section>
          {p.market && <Section n={++n} title={t("The market")}><p className="whitespace-pre-line text-[14px] leading-relaxed">{p.market}</p></Section>}
          <Section n={++n} title={t("The sales plan")}>
            <div className="overflow-x-auto" role="region" aria-label={t("Table")} tabIndex={0}><table className="w-full min-w-[520px] text-[13px]">
              <thead><tr className="border-b border-line text-[11px] uppercase text-mute"><th className="py-1 text-start">{t("Product line")}</th><th className="text-end">{t("Units a year")}</th><th className="text-end">{t("Price")}</th><th className="text-end">{t("Cost per unit")}</th><th className="text-end">{t("Margin")}</th><th className="text-end">{t("Units growth")}</th><th className="text-end">{t("Price growth")}</th></tr></thead>
              <tbody>{p.lines.map((l) => <tr key={l.id} className="border-b border-line/60"><td className="py-1">{l.name}</td><td className="num text-end">{l.units.toLocaleString("en-US")}</td><td className="num text-end">{wm(l.price, cur)}</td><td className="num text-end">{wm(l.unitCost, cur)}</td><td className="num text-end">{l.price ? pct(((l.price - l.unitCost) / l.price) * 100, 0) : "–"}</td><td className="num text-end">{pct(l.growthUnits, 0)}</td><td className="num text-end">{pct(l.growthPrice, 0)}</td></tr>)}</tbody>
            </table></div>
          </Section>
          <Section n={++n} title={t("Investment and financing")}>
            <ul className="mb-3 space-y-1 text-[13px]">
              {p.capex.map((c) => <li key={c.id}>{c.name}: <b className="num">{wm(c.amount, cur)}</b> · {pm(p, c.month)} · {t("{n} years", { n: c.lifeYears })}</li>)}
              {p.loans.map((l) => <li key={l.id}>{l.name}: <b className="num">{wm(l.amount, cur)}</b> · {pm(p, l.month)} · {pct(l.rate, 1)} · {t("{n} months", { n: l.termMonths })} · {t("Monthly instalment")} {wm(loanPayment(l), cur)}</li>)}
              {p.equity.map((e) => <li key={e.id}>{e.name}: <b className="num">{wm(e.amount, cur)}</b> · {pm(p, e.month)}</li>)}
            </ul>
            <div className="grid gap-6 md:grid-cols-2">
              <div><h4 className="mb-2 text-[13px] font-semibold">{t("Where the cash comes from")}</h4><ShareBar cur={cur} parts={su.sources.map((x) => ({ label: t(x.label), value: x.value }))} /></div>
              <div><h4 className="mb-2 text-[13px] font-semibold">{t("Where it goes")}</h4><ShareBar cur={cur} parts={su.uses.map((x) => ({ label: t(x.label), value: x.value }))} /></div>
            </div>
          </Section>
          <Section n={++n} title={t("Projected statements")}>
            <h4 className="mb-1 text-[13px] font-semibold">{t("Profit and loss")}</h4>
            <StatementTable lines={PL} cols={labels} get={(k, i) => Number(years[i][k])} />
            <div className="my-3"><Bridge cur={cur} height={240} rows={[{ label: t("Sales"), value: y1.revenue, total: true }, { label: t("Cost of sales"), value: -y1.cogs }, { label: t("Staff"), value: -y1.staff }, { label: t("Overheads"), value: -y1.overheads }, { label: t("Depreciation"), value: -y1.depreciation }, { label: t("Interest"), value: -y1.interest }, { label: t("Income tax"), value: -y1.tax }, { label: t("Net profit"), value: y1.net, total: true }]} /></div>
            <h4 className="mb-1 mt-3 text-[13px] font-semibold">{t("Balance sheet")}</h4>
            <StatementTable lines={BS} cols={labels} get={(k, i) => Number(years[i][k])} />
            <h4 className="mb-1 mt-3 text-[13px] font-semibold">{t("Cash flow")}</h4>
            <StatementTable lines={CF} cols={labels} get={(k, i) => Number(years[i][k])} />
          </Section>
          <Section n={++n} title={t("Financial indicators")}>
            <table className="mb-3 w-full text-[13px]"><tbody>
              {[[t("NPV at {rate}", { rate: pct(p.discountRate, 0) }), wm(ind.npv, cur)], [t("IRR"), ind.irr === null ? "–" : pct(ind.irr, 1)], [t("Payback"), ind.payback === null ? t("Not within the plan") : ind.payback === 0 ? t("From the start") : t("{n} years", { n: ind.payback.toFixed(1) })],
                [t("Break-even sales"), ind.breakEven === null ? "–" : wm(ind.breakEven, cur)], [t("Lowest cash"), wm(ind.minCash, cur)]].map(([l, v]) => <tr key={l} className="border-b border-line/60"><th scope="row" className="py-1 text-start font-normal text-mute">{l}</th><td className="num py-1 text-end">{v}</td></tr>)}
            </tbody></table>
            <div className="overflow-x-auto" role="region" aria-label={t("Table")} tabIndex={0}><table className="w-full min-w-[520px] text-[13px]">
              <thead><tr className="border-b border-line text-[11px] uppercase text-mute"><th className="py-1 text-start">{t("Ratio")}</th>{ratios.map((r) => <th key={r.label} className="text-end">{r.label}</th>)}</tr></thead>
              <tbody>{([["grossMargin", "Gross margin", "pct"], ["netMargin", "Net margin", "pct"], ["currentRatio", "Current ratio", "x"], ["dscr", "Debt service cover (DSCR)", "x"], ["roe", "Return on equity", "pct"]] as const).map(([k, l, u]) => (
                <tr key={k} className="border-b border-line/60"><td className="py-1">{t(l)}</td>{ratios.map((r) => { const v = r[k]; return <td key={r.label} className="num text-end">{v === null ? "–" : u === "pct" ? pct(v, 1) : `${v.toFixed(2)}×`}</td>; })}</tr>
              ))}</tbody>
            </table></div>
          </Section>
          <Section n={++n} title={t("Sensitivity")}>
            <table className="mb-3 w-full text-[13px]"><thead><tr className="border-b border-line text-[11px] uppercase text-mute"><th className="py-1 text-start">{t("Year")}</th>{cases.map((c) => <th key={c.s.id} className="text-end">{t(c.s.label)}</th>)}</tr></thead>
              <tbody>{labels.map((l, i) => <tr key={l} className="border-b border-line/60"><td className="py-1">{l}</td>{cases.map((c) => <td key={c.s.id} className="num text-end">{wm(c.years[i].net, cur)}</td>)}</tr>)}</tbody></table>
            <p className="mb-3 text-[12.5px] text-mute">{t("Best case: units {u}%, prices {p}%, cost per unit {c}%, staff and overheads {e}%.", { u: p.scenarios.best.units, p: p.scenarios.best.price, c: p.scenarios.best.cost, e: p.scenarios.best.expenses })} {t("Worst case: units {u}%, prices {p}%, cost per unit {c}%, staff and overheads {e}%.", { u: p.scenarios.worst.units, p: p.scenarios.worst.price, c: p.scenarios.worst.cost, e: p.scenarios.worst.expenses })}</p>
            <Tornado rows={tor.map((r) => ({ label: t(r.label), low: r.low, high: r.high }))} base={tor[0]?.base ?? 0} fmt={(v) => cm(v, cur)} lowLabel={t("{pct} lower", { pct: "10%" })} highLabel={t("{pct} higher", { pct: "10%" })} />
          </Section>
          <p className="border-t border-line pt-3 text-[11.5px] text-mute">{t("Figures are before VAT. NPV and IRR are of the free cash flow over the plan's years, with no value for the years after. Years are calendar years.")}</p>
        </article>
      </StaticCharts.Provider>
    </div>
  );
}

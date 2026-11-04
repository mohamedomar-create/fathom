"use client";
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { pct } from "@/lib/engine/format";
import { byYear, cagr, fundingFix, lineSales, projectMonths, sensitivity, sourcesAndUses, type BusinessPlan, type Metric, type PlanCheck, type PlanPeriod, type ScenarioName } from "@/lib/engine/plan";
import { CardGrid, ChartCard } from "@/components/viz/chart-card";
import { ColumnChart } from "@/components/charts/column-chart";
import { LineChart } from "@/components/charts/line-chart";
import { Bridge } from "@/components/viz/bridge";
import { KpiTile } from "@/components/viz/kpi";
import { ShareBar } from "@/components/viz/share-bar";
import { Tornado } from "@/components/viz/tornado";
import { ramp } from "@/components/viz/palette";
import { BS, CF, PL, SCENARIOS, downloadPlan, usePlanMath, type Line } from "./plan-model";
import { cell, cm, usePlanMonth, usePlanT, useCheckText, useSettled, wm } from "./plan-ui";
import type { SetPlan } from "./plan-inputs";

const rid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

export function ScenarioSwitch({ sc, setSc }: { sc: ScenarioName; setSc: (s: ScenarioName) => void }) {
  const { t } = usePlanT();
  return (
    <div role="radiogroup" aria-label={t("Scenario")} className="inline-flex rounded-lg border border-line bg-white p-0.5 text-[13px]">
      {SCENARIOS.map((s) => (
        <button key={s.id} type="button" role="radio" aria-checked={sc === s.id} onClick={() => setSc(s.id)} data-testid={`plan-sc-${s.id}`}
          className={cn("rounded-md px-3 py-1", sc === s.id ? "bg-brand-d text-white" : "text-mute hover:text-ink")}>{t(s.label)}</button>
      ))}
    </div>
  );
}

const LEVEL = { critical: { icon: XCircle, cls: "text-red", box: "border-s-red" }, warning: { icon: AlertTriangle, cls: "text-amber-700", box: "border-s-amber" }, good: { icon: CheckCircle2, cls: "text-green-d", box: "border-s-green" } } as const;

/** The plan check, read the way a banker would: problems first, then warnings, then good news, with the fix for a cash gap. */
export function PlanCheckList({ checks, cur, onFund, readOnly, compact }: { checks: PlanCheck[]; cur: string; onFund?: () => void; readOnly?: boolean; compact?: boolean }) {
  const { t } = usePlanT();
  const text = useCheckText(cur);
  return (
    <ul className="space-y-2" data-testid="plan-checks">
      {checks.map((c, i) => {
        const L = LEVEL[c.level];
        return (
          <li key={c.id + i} className={cn("flex items-start gap-2 rounded-md border border-line border-s-4 bg-white px-3 py-2 text-[13px]", L.box)} data-level={c.level}>
            <L.icon className={cn("mt-0.5 h-4 w-4 shrink-0", L.cls)} role="img" aria-label={t(c.level === "critical" ? "Problem" : c.level === "warning" ? "Warning" : "Good")} />
            <span className="flex-1">{text(c)}</span>
            {c.fix === "fund" && onFund && !readOnly && !compact && <button type="button" onClick={onFund} className="shrink-0 rounded bg-brand-d px-2.5 py-1 text-[12px] font-medium text-white" data-testid="plan-fund-fix">{t("Fix it")}</button>}
          </li>
        );
      })}
    </ul>
  );
}

export function Overview({ p, set, sc, setSc, cur, readOnly, go }: { p: BusinessPlan; set: SetPlan; sc: ScenarioName; setSc: (s: ScenarioName) => void; cur: string; readOnly: boolean; go: (tab: string) => void }) {
  const { t, T } = usePlanT();
  const pm = usePlanMonth();
  const { months, years, ind, checks } = usePlanMath(p, sc);
  const [wy, setWy] = useState(0);
  const labels = years.map((y) => y.label);
  const first = years[0], last = years.at(-1)!;
  const g = cagr(first.revenue, last.revenue, years.length);
  const totalNet = years.reduce((s, y) => s + y.net, 0), totalRev = years.reduce((s, y) => s + y.revenue, 0);
  const fix = fundingFix(months, ind);
  const fund = () => fix && set({ equity: [...p.equity, { id: rid("pq"), name: t("Capital to cover the cash gap"), amount: fix.amount, month: fix.month }] });
  const su = sourcesAndUses(p, months);
  const ls = lineSales(p, sc).sort((a, b) => (b.years[0] ?? 0) - (a.years[0] ?? 0));
  const shown = ls.slice(0, 6), rest = ls.slice(6);
  const lineSeries = [...shown.map((l, i) => ({ name: l.name, values: l.years, color: ramp(shown.length)[i] })), ...(rest.length ? [{ name: t("Other"), values: labels.map((_, y) => rest.reduce((s, l) => s + (l.years[y] ?? 0), 0)), color: "#a9a9a3" }] : [])];
  const y = years[Math.min(wy, years.length - 1)];
  const bridge = [
    { label: t("Sales"), value: y.revenue, total: true }, { label: t("Cost of sales"), value: -y.cogs }, { label: t("Gross profit"), value: y.gross, total: true },
    { label: t("Staff"), value: -y.staff }, { label: t("Overheads"), value: -y.overheads }, { label: t("EBITDA"), value: y.ebitda, total: true },
    { label: t("Depreciation"), value: -y.depreciation }, { label: t("Interest"), value: -y.interest }, { label: t("Income tax"), value: -y.tax }, { label: t("Net profit"), value: y.net, total: true },
  ];
  if (!p.lines.length) return (
    <div className="rounded-xl border border-dashed border-line bg-white p-10 text-center" data-testid="plan-start-sales">
      <h3 className="t-card">{t("Start with what you sell")}</h3>
      <p className="mt-1 text-sm text-mute">{t("Add your product lines: units a year, price and cost per unit.")}</p>
      <button type="button" onClick={() => go("sales")} className="mt-4 rounded bg-brand-d px-4 py-2 text-sm font-medium text-white">{t("Go to Sales")}</button>
    </div>
  );
  return (
    <div className="space-y-4" data-testid="plan-overview">
      <div className="flex flex-wrap items-center justify-between gap-2"><ScenarioSwitch sc={sc} setSc={setSc} /></div>
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiTile label={t("Sales in the last year")} value={cm(last.revenue, cur)} sub={g === null ? undefined : t("{pct} a year from Y1", { pct: pct(g, 1) })} now={years.map((x) => x.revenue)} testId="plan-kpi-sales" />
        <KpiTile label={t("Net profit over the plan")} value={cm(totalNet, cur)} neg={totalNet < 0} sub={totalRev ? t("{pct} of sales", { pct: pct((totalNet / totalRev) * 100, 1) }) : undefined} now={years.map((x) => x.net)} testId="plan-kpi-net" />
        <KpiTile label={t("EBITDA in the last year")} value={cm(last.ebitda, cur)} neg={last.ebitda < 0} sub={last.revenue ? t("{pct} of sales", { pct: pct((last.ebitda / last.revenue) * 100, 1) }) : undefined} now={years.map((x) => x.ebitda)} testId="plan-kpi-ebitda" />
        {ind.fundingNeeded > 0
          ? <KpiTile label={t("Funding needed")} value={cm(ind.fundingNeeded, cur)} neg accent="bad" sub={t("by {month}", { month: pm(p, months.findIndex((m) => m.label === ind.minCashMonth) + 1) })} now={years.map((x) => x.cash)} testId="plan-kpi-cash" />
          : <KpiTile label={t("Lowest cash")} value={cm(ind.minCash, cur)} accent="good" sub={pm(p, months.findIndex((m) => m.label === ind.minCashMonth) + 1)} now={years.map((x) => x.cash)} testId="plan-kpi-cash" />}
        <KpiTile label={t("NPV")} value={cm(ind.npv, cur)} neg={ind.npv < 0} sub={ind.irr === null ? t("IRR: no outlay to recover · at {rate}", { rate: pct(p.discountRate, 0) }) : `${t("IRR")} ${pct(ind.irr, 1)} · ${t("at {rate}", { rate: pct(p.discountRate, 0) })}`} testId="plan-kpi-npv" />
        <KpiTile label={t("Payback")} value={ind.payback === null ? t("Not within the plan") : ind.payback === 0 ? t("From the start") : t("{n} years", { n: ind.payback.toFixed(1) })} sub={ind.breakEven === null ? undefined : t("Break-even sales {amount}", { amount: cm(ind.breakEven, cur) })} testId="plan-kpi-payback" />
      </div>
      <CardGrid>
        <ChartCard title={t("Sales and profit")} table={{ head: [t("Year"), t("Sales"), t("Net profit")], rows: years.map((x) => [x.label, wm(x.revenue, cur), wm(x.net, cur)]) }} testId="plan-chart-sales-profit">
          <ColumnChart labels={labels} cur={cur} height={240} series={[{ name: t("Sales"), values: years.map((x) => x.revenue), color: ramp(2)[0] }, { name: t("Net profit"), values: years.map((x) => x.net), color: ramp(2)[1] }]} />
        </ChartCard>
        <ChartCard title={t("Plan check")} sub={t("Read the way a bank reads a plan")} testId="plan-check-card">
          <PlanCheckList checks={checks} cur={cur} onFund={fix ? fund : undefined} readOnly={readOnly} />
          {fix && !readOnly && <p className="mt-2 text-[12px] text-mute">{t("Fix it adds {amount} of capital in {month}.", { amount: cm(fix.amount, cur), month: pm(p, fix.month) })}</p>}
        </ChartCard>
        <ChartCard title={t("Cash, month by month")} sub={t("Lowest {amount} in {month}", { amount: cm(ind.minCash, cur), month: pm(p, months.findIndex((m) => m.label === ind.minCashMonth) + 1) })} wide
          table={{ head: [t("Month"), t("Cash")], rows: months.map((m, i) => [pm(p, i + 1), wm(m.cash, cur)]) }} testId="plan-chart-cash">
          <LineChart labels={months.map((m) => T.ms(m.label))} cur={cur} height={240} legend={false} series={[{ name: t("Cash"), values: months.map((m) => m.cash), color: ind.fundingNeeded > 0 ? "#b8242a" : ramp(1)[0], fill: true, dots: false }]} />
        </ChartCard>
        <ChartCard title={t("From sales to net profit")} sub={y.label} right={
          <select aria-label={t("Year")} value={wy} onChange={(e) => setWy(Number(e.target.value))} className="rounded border border-line bg-white px-2 py-1 text-[12px]">{years.map((x, i) => <option key={x.label} value={i}>{x.label}</option>)}</select>
        } table={{ head: [t("Item"), t("Amount")], rows: bridge.map((b) => [b.label, wm(b.value, cur)]) }} testId="plan-chart-bridge">
          <Bridge rows={bridge} cur={cur} height={260} />
        </ChartCard>
        <ChartCard title={t("Sales by product line")} table={{ head: [t("Line"), ...labels], rows: lineSeries.map((s) => [s.name, ...s.values.map((v) => wm(v ?? 0, cur))]) }} testId="plan-chart-lines">
          <ColumnChart stacked labels={labels} cur={cur} height={240} series={lineSeries} />
        </ChartCard>
        <ChartCard title={t("Sources and uses of cash")} sub={t("Over the whole plan")} wide testId="plan-sources-uses">
          <div className="grid gap-6 md:grid-cols-2">
            <div><h4 className="mb-2 text-[13px] font-semibold">{t("Where the cash comes from")}</h4><ShareBar cur={cur} label={t("Where the cash comes from")} parts={su.sources.map((x) => ({ label: t(x.label), value: x.value }))} /></div>
            <div><h4 className="mb-2 text-[13px] font-semibold">{t("Where it goes")}</h4><ShareBar cur={cur} label={t("Where it goes")} parts={su.uses.map((x) => ({ label: t(x.label), value: x.value }))} /></div>
          </div>
        </ChartCard>
      </CardGrid>
    </div>
  );
}

/** One statement as a table: a sticky first column, negatives in brackets, subtotals shaded, totals ruled. */
export function StatementTable({ lines, cols, get, testId, extra }: { lines: Line[]; cols: string[]; get: (k: keyof PlanPeriod, i: number) => number; testId?: string; extra?: (k: keyof PlanPeriod) => React.ReactNode }) {
  const { t } = usePlanT();
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white" role="region" aria-label={t("Statement")} tabIndex={0} data-testid={testId}>
      <table className="w-full min-w-[560px] border-collapse text-[13px]">
        <thead><tr className="border-b border-line bg-panel text-[11px] uppercase tracking-wide text-mute">
          <th scope="col" className="sticky start-0 bg-panel px-3 py-2 text-start font-semibold">{t("Item")}</th>
          {cols.map((c) => <th key={c} scope="col" className="px-3 py-2 text-end font-semibold">{c}</th>)}
          {extra && <th scope="col" className="px-3 py-2 text-end font-semibold">{t("Total")}</th>}
        </tr></thead>
        <tbody>
          {lines.map(([k, label, kind]) => (
            <tr key={k + label} className={cn("border-b border-line/60", kind === "sub" && "bg-band/50 font-medium", kind === "total" && "border-t-2 border-t-ink/50 font-semibold")}>
              <th scope="row" className={cn("sticky start-0 px-3 py-1.5 text-start font-[inherit]", kind ? "bg-band/50" : "bg-white")}>{t(label)}</th>
              {cols.map((c, i) => { const v = get(k, i); return <td key={c} className={cn("num px-3 py-1.5 text-end", v < -0.5 && "text-red")}>{cell(v)}</td>; })}
              {extra && <td className="num px-3 py-1.5 text-end">{extra(k)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StatementsTab({ p, sc, setSc }: { p: BusinessPlan; sc: ScenarioName; setSc: (s: ScenarioName) => void; cur?: string }) {
  const { t } = usePlanT();
  const pm = usePlanMonth();
  const { months, years, ratios } = usePlanMath(p, sc);
  const [which, setWhich] = useState<"pl" | "bs" | "cf" | "ratios">("pl");
  const [period, setPeriod] = useState<string>("years");
  const agree = months.every((m) => Math.abs(m.check) < 0.05);
  const byMonth = period !== "years";
  const ms = byMonth ? months.filter((m) => m.label.startsWith(period)) : [];
  const cols = byMonth ? ms.map((m) => pm(p, months.indexOf(m) + 1)) : years.map((y) => y.label);
  const src = byMonth ? ms : years;
  const lines = which === "pl" ? PL : which === "bs" ? BS : CF;
  const FLOW = new Set<keyof PlanPeriod>(["revenue", "cogs", "gross", "staff", "overheads", "ebitda", "depreciation", "interest", "tax", "net", "operating", "investing", "financing", "netCash"]);
  const R: [keyof (typeof ratios)[number], string, string, "pct" | "x"][] = [
    ["growth", "Sales growth", "Change in sales on the year before", "pct"], ["grossMargin", "Gross margin", "Gross profit as % of sales", "pct"],
    ["ebitdaMargin", "EBITDA margin", "EBITDA as % of sales", "pct"], ["netMargin", "Net margin", "Net profit as % of sales", "pct"],
    ["currentRatio", "Current ratio", "What the business owns short term for each pound it owes short term", "x"], ["debtToEquity", "Debt to equity", "Loans for each pound of equity", "x"],
    ["dscr", "Debt service cover (DSCR)", "Cash from trading for each pound of loan payments: banks usually ask for 1.25×", "x"], ["roe", "Return on equity", "Net profit as % of year-end equity", "pct"],
  ];
  return (
    <div className="space-y-3" data-testid="plan-statements">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label={t("Statement")} className="inline-flex rounded-lg border border-line bg-white p-0.5 text-[13px]">
          {([["pl", "Profit and loss"], ["bs", "Balance sheet"], ["cf", "Cash flow"], ["ratios", "Ratios"]] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={which === k} onClick={() => setWhich(k)} className={cn("rounded-md px-3 py-1", which === k ? "bg-brand-d text-white" : "text-mute hover:text-ink")}>{t(l)}</button>
          ))}
        </div>
        {which !== "ratios" && <select aria-label={t("Period")} value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded border border-line bg-white px-2 py-1.5 text-[13px]">
          <option value="years">{t("By year")}</option>{years.map((y) => <option key={y.label} value={y.label}>{t("{year} by month", { year: y.label })}</option>)}
        </select>}
        <ScenarioSwitch sc={sc} setSc={setSc} />
        <button type="button" onClick={() => downloadPlan(p, (en) => t(en))} className="ms-auto rounded border border-line bg-white px-3 py-1.5 text-[13px] hover:border-brand" data-testid="plan-csv">{t("Excel (CSV)")}</button>
      </div>
      {agree
        ? <p className="inline-flex items-center gap-1.5 rounded-full bg-green-bg px-3 py-1 text-[12.5px] text-green-d" data-testid="plan-agree"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />{t("The statements agree: the balance sheet balances every month")}</p>
        : <p className="inline-flex items-center gap-1.5 rounded-full bg-red-bg px-3 py-1 text-[12.5px] text-red"><XCircle className="h-3.5 w-3.5" aria-hidden />{t("The statements don’t agree")}</p>}
      {which === "ratios" ? (
        <div className="overflow-x-auto rounded-xl border border-line bg-white" role="region" aria-label={t("Ratios")} tabIndex={0} data-testid="plan-ratios">
          <table className="w-full min-w-[560px] border-collapse text-[13px]">
            <thead><tr className="border-b border-line bg-panel text-[11px] uppercase tracking-wide text-mute"><th scope="col" className="px-3 py-2 text-start">{t("Ratio")}</th>{ratios.map((r) => <th key={r.label} scope="col" className="px-3 py-2 text-end">{r.label}</th>)}</tr></thead>
            <tbody>{R.map(([k, l, about, unit]) => (
              <tr key={k} className="border-b border-line/60">
                <th scope="row" className="px-3 py-1.5 text-start font-normal"><div className="font-medium">{t(l)}</div><div className="text-[11.5px] text-mute">{t(about)}</div></th>
                {ratios.map((r) => { const v = r[k] as number | null; return <td key={r.label} className={cn("num px-3 py-1.5 text-end", k === "dscr" && v !== null && v < 1.25 && "bg-amber-50 text-amber-800")}>{v === null ? "–" : unit === "pct" ? pct(v, 1) : `${v.toFixed(2)}×`}</td>; })}
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <StatementTable lines={lines} cols={cols} get={(k, i) => Number(src[i][k])} testId={`plan-table-${which}`}
          extra={byMonth ? (k) => (FLOW.has(k) ? cell(ms.reduce((s, m) => s + Number(m[k]), 0)) : cell(Number(ms.at(-1)?.[k] ?? 0))) : undefined} />
      )}
    </div>
  );
}

export function ScenariosTab({ p, set, cur, readOnly }: { p: BusinessPlan; set: SetPlan; cur: string; readOnly: boolean }) {
  const { t } = usePlanT();
  const settled = useSettled(p);
  const math = useMemo(() => SCENARIOS.map((s) => { const months = projectMonths(settled, s.id); return { s, months, years: byYear(months) }; }), [settled]);
  const [metric, setMetric] = useState<Metric>("npv");
  const [share, setShare] = useState(0.1);
  const tor = useMemo(() => sensitivity(settled, metric, share), [settled, metric, share]);
  const labels = math[0].years.map((y) => y.label);
  const fmt = (v: number) => cm(v, cur);
  const SL: [keyof BusinessPlan["scenarios"]["best"], string][] = [["units", "Units sold"], ["price", "Prices"], ["cost", "Cost per unit"], ["expenses", "Staff and overheads"]];
  return (
    <div className="space-y-4" data-testid="plan-scenarios">
      <div className="grid gap-3 lg:grid-cols-3">
        {math.map(({ s, months, years }) => {
          const net = years.reduce((x, y) => x + y.net, 0);
          const low = Math.min(...months.map((m) => m.cash));
          const def = s.id === "base" ? null : settled.scenarios[s.id];
          return (
            <section key={s.id} className={cn("rounded-xl border bg-white p-4", s.id === "base" ? "border-brand ring-1 ring-brand" : "border-line")} data-testid={`plan-case-${s.id}`}>
              <h3 className="t-card">{t(s.label)}</h3>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[13px]">
                <dt className="text-mute">{t("Net profit")}</dt><dd className={cn("num text-end font-semibold", net < 0 && "text-red")}>{cm(net, cur)}</dd>
                <dt className="text-mute">{low < 0 ? t("Funding needed") : t("Lowest cash")}</dt><dd className={cn("num text-end font-semibold", low < 0 && "text-red")}>{cm(Math.abs(low), cur)}</dd>
              </dl>
              {def ? (
                <div className="mt-3 space-y-2">
                  {SL.map(([k, l]) => (
                    <label key={k} className="block text-[12.5px]">
                      <span className="flex justify-between"><span>{t(l)}</span><span className="num">{def[k] > 0 ? "+" : ""}{def[k]}%</span></span>
                      <input type="range" min={Math.min(-50, def[k])} max={Math.max(50, def[k])} step={1} value={def[k]} disabled={readOnly} aria-label={`${t(s.label)}: ${t(l)}`}
                        onChange={(e) => set({ scenarios: { ...p.scenarios, [s.id]: { ...p.scenarios[s.id as "best" | "worst"], [k]: Number(e.target.value) } } })} className="w-full accent-[#0b6e70]" />
                    </label>
                  ))}
                </div>
              ) : <p className="mt-3 text-[12.5px] text-mute">{t("The plan as you entered it.")}</p>}
            </section>
          );
        })}
      </div>
      <CardGrid>
        <ChartCard title={t("Net profit in the three cases")} table={{ head: [t("Year"), ...SCENARIOS.map((s) => t(s.label))], rows: labels.map((l, i) => [l, ...math.map((m) => wm(m.years[i].net, cur))]) }} testId="plan-chart-cases">
          <ColumnChart labels={labels} cur={cur} height={240} series={math.map((m, i) => ({ name: t(m.s.label), values: m.years.map((y) => y.net), color: ramp(3)[[2, 0, 1][i]] }))} />
        </ChartCard>
        <ChartCard title={t("Cash in the three cases")} table={{ head: [t("Year"), ...SCENARIOS.map((s) => t(s.label))], rows: labels.map((l, i) => [l, ...math.map((m) => wm(m.years[i].cash, cur))]) }} testId="plan-chart-cases-cash">
          <LineChart labels={labels} cur={cur} height={240} series={math.map((m, i) => ({ name: t(m.s.label), values: m.years.map((y) => y.cash), color: ramp(3)[[2, 0, 1][i]] }))} />
        </ChartCard>
        <ChartCard title={t("What moves the plan most")} sub={t("Each assumption moved down and up, the rest kept")} wide testId="plan-tornado" right={
          <div className="flex gap-1">
            <select aria-label={t("Figure")} value={metric} onChange={(e) => setMetric(e.target.value as Metric)} className="rounded border border-line bg-white px-2 py-1 text-[12px]">
              <option value="npv">{t("NPV")}</option><option value="profit">{t("Net profit")}</option><option value="cash">{t("Lowest cash")}</option>
            </select>
            <select aria-label={t("Move by")} value={share} onChange={(e) => setShare(Number(e.target.value))} className="rounded border border-line bg-white px-2 py-1 text-[12px]">
              {[0.05, 0.1, 0.2].map((x) => <option key={x} value={x}>±{x * 100}%</option>)}
            </select>
          </div>
        }>
          <Tornado rows={tor.map((r) => ({ label: t(r.label), low: r.low, high: r.high }))} base={tor[0]?.base ?? 0} fmt={fmt}
            lowLabel={t("{pct} lower", { pct: `${share * 100}%` })} highLabel={t("{pct} higher", { pct: `${share * 100}%` })} />
        </ChartCard>
      </CardGrid>
    </div>
  );
}

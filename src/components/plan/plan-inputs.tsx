"use client";
import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { pct } from "@/lib/engine/format";
import { byYear, indicators, lineSales, loanPayment, openingLoans, projectMonths, type BusinessPlan, type PlanCapex, type PlanEquity, type PlanExpense, type PlanLine, type PlanLoan, type PlanOpening, type PlanStaff } from "@/lib/engine/plan";
import { ChartCard } from "@/components/viz/chart-card";
import { ColumnChart } from "@/components/charts/column-chart";
import { DeltaBadge } from "@/components/viz/kpi";
import { ShareBar } from "@/components/viz/share-bar";
import { ramp } from "@/components/viz/palette";
import { cm, Editor, NumIn, usePlanMonth, usePlanT, wm, type Col } from "./plan-ui";

export type SetPlan = (patch: Partial<BusinessPlan>) => void;
const rid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

/** As you type: what the change does to the headline figures, against the plan as it was when opened. */
export function Impact({ p, opened, cur }: { p: BusinessPlan; opened: BusinessPlan; cur: string }) {
  const { t } = usePlanT();
  const fig = (x: BusinessPlan) => {
    const ms = projectMonths(x), ys = byYear(ms), ind = indicators(x, ms);
    return { y1: ys[0]?.revenue ?? 0, yN: ys.at(-1)?.revenue ?? 0, net: ys.reduce((s, y) => s + y.net, 0), low: ind.minCash, npv: ind.npv };
  };
  const now = useMemo(() => fig(p), [p]);
  const was = useMemo(() => fig(opened), [opened]);
  const items: [string, number, number][] = [
    [t("Sales Y1"), now.y1, was.y1], [t("Sales in the last year"), now.yN, was.yN], [t("Net profit over the plan"), now.net, was.net], [t("Lowest cash"), now.low, was.low], [t("NPV"), now.npv, was.npv],
  ];
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 rounded-xl border border-line bg-panel p-3 sm:grid-cols-5" data-testid="plan-impact" aria-live="polite">
      {items.map(([label, v, w]) => (
        <div key={label} className="min-w-0">
          <div className="label truncate">{label}</div>
          <div className={cn("num text-[15px] font-semibold", v < 0 && "text-red")}>{cm(v, cur)}</div>
          {Math.abs(v - w) >= 0.5 && <DeltaBadge value={w ? ((v - w) / Math.abs(w)) * 100 : null} label={t("since opened")} />}
        </div>
      ))}
    </div>
  );
}

const SEASONS: { key: string; w: number[] }[] = [
  { key: "Even", w: Array(12).fill(1) },
  { key: "Busier at the year end", w: [0.8, 0.8, 0.9, 0.9, 0.9, 1, 1, 1, 1.1, 1.2, 1.3, 1.5] },
  { key: "Busier in summer", w: [0.8, 0.8, 0.9, 1, 1.2, 1.4, 1.5, 1.4, 1.1, 0.9, 0.8, 0.8] },
  { key: "Busier in winter", w: [1.4, 1.3, 1.1, 0.9, 0.8, 0.7, 0.7, 0.8, 0.9, 1.1, 1.3, 1.4] },
  { key: "Back to school", w: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 1, 1.3, 1.6, 1.2, 0.9, 0.9] },
];

export function SalesTab({ p, set, opened, cur, readOnly }: { p: BusinessPlan; set: SetPlan; opened: BusinessPlan; cur: string; readOnly: boolean }) {
  const { t, T } = usePlanT();
  const ls = lineSales(p);
  const y1 = ls.reduce((s, l) => s + (l.years[0] ?? 0), 0);
  const ys = Array.from({ length: p.years }, (_, i) => String(p.startYear + i));
  const top = [...ls].sort((a, b) => (b.years[0] ?? 0) - (a.years[0] ?? 0));
  const shown = top.slice(0, 6), rest = top.slice(6);
  const series = [...shown.map((l, i) => ({ name: l.name, values: l.years, color: ramp(shown.length)[i] })),
    ...(rest.length ? [{ name: t("Other"), values: ys.map((_, y) => rest.reduce((s, l) => s + (l.years[y] ?? 0), 0)), color: "#a9a9a3" }] : [])];
  const cols: Col<PlanLine>[] = [
    { key: "name", label: t("Product line"), kind: "text", width: "22%" },
    { key: "units", label: t("Units a year"), kind: "num", min: 0 },
    { key: "price", label: t("Price"), kind: "num", min: 0 },
    { key: "unitCost", label: t("Cost per unit"), kind: "num", min: 0 },
    { key: "growthUnits", label: t("Units growth"), kind: "num", suffix: "%" },
    { key: "growthPrice", label: t("Price growth"), kind: "num", suffix: "%" },
    { key: "margin", label: t("Margin"), kind: "calc", calc: (r) => {
      const m = r.price > 0 ? ((r.price - r.unitCost) / r.price) * 100 : null;
      return m === null ? "–" : <span className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-semibold", m < 0 ? "bg-red-bg text-red" : m < 20 ? "bg-amber-50 text-amber-800" : "bg-green-bg text-green-d")}>{pct(m, 0)}</span>;
    } },
    { key: "y1", label: t("Sales Y1"), kind: "calc", calc: (r) => wm(ls.find((l) => l.id === r.id)?.years[0] ?? 0, cur), total: wm(y1, cur) },
    { key: "share", label: t("Share"), kind: "calc", calc: (r) => { const v = ls.find((l) => l.id === r.id)?.years[0] ?? 0; const s = y1 ? (v / y1) * 100 : 0; return <span className="flex items-center justify-end gap-1.5"><span className="h-1.5 w-12 overflow-hidden rounded-full bg-band" aria-hidden><span className="block h-full bg-brand" style={{ width: `${Math.max(0, Math.min(100, s))}%` }} /></span>{pct(s, 0)}</span>; } },
  ];
  const sum = p.season.reduce((s, w) => s + Math.max(0, w), 0) || 12;
  const busiest = p.season.indexOf(Math.max(...p.season));
  return (
    <div className="space-y-4" data-testid="plan-sales">
      <Impact p={p} opened={opened} cur={cur} />
      <Editor title={t("What you sell")} rows={p.lines} cols={cols} readOnly={readOnly} onChange={(lines) => set({ lines })} testId="plan-lines"
        make={() => ({ id: rid("pl"), name: t("New product"), units: 0, price: 0, unitCost: 0, growthUnits: 10, growthPrice: 10 })} addLabel={t("Add a line")} emptyLabel={t("Add your first product line")} />
      {p.lines.length > 0 && (
        <ChartCard title={t("Sales by product line")} sub={t("Each year, the largest lines first")} table={{ head: [t("Line"), ...ys], rows: series.map((s) => [s.name, ...s.values.map((v) => wm(v ?? 0, cur))]) }} testId="plan-sales-chart">
          <ColumnChart stacked labels={ys} cur={cur} height={240} series={series} />
        </ChartCard>
      )}
      <section className="rounded-xl border border-line bg-white p-4" data-testid="plan-season">
        <h3 className="t-card">{t("When in the year you sell")}</h3>
        <p className="t-cap mb-3">{t("The busiest month is {month}.", { month: T.ml(`${p.startYear}-${String(busiest + 1).padStart(2, "0")}`).split(" ")[0] })}</p>
        {!readOnly && <div className="mb-3 flex flex-wrap gap-1.5">{SEASONS.map((s) => (
          <button key={s.key} type="button" onClick={() => set({ season: s.w })} className={cn("rounded-full border px-3 py-1 text-[12.5px]", JSON.stringify(s.w) === JSON.stringify(p.season) ? "border-brand bg-brand-bg text-brand-d" : "border-line hover:border-brand")}>{t(s.key)}</button>
        ))}</div>}
        <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
          {p.season.map((w, i) => {
            const share = (Math.max(0, w) / sum) * 100;
            return (
              <div key={i} className="flex flex-col items-center gap-1">
                <span className="num text-[11px] text-mute">{pct(share, 0)}</span>
                <div className="flex h-16 w-full items-end rounded bg-band" aria-hidden><div className="w-full rounded-t bg-brand" style={{ height: `${Math.min(100, share * 4)}%` }} /></div>
                <NumIn label={`${t("Weight")} ${T.ml(`${p.startYear}-${String(i + 1).padStart(2, "0")}`)}`} value={w} min={0} disabled={readOnly} onChange={(v) => set({ season: p.season.map((x, j) => (j === i ? v : x)) })} />
                <span className="text-[11px] text-mute">{T.ml(`${p.startYear}-${String(i + 1).padStart(2, "0")}`).split(" ")[0]}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export function CostsTab({ p, set, opened, cur, readOnly }: { p: BusinessPlan; set: SetPlan; opened: BusinessPlan; cur: string; readOnly: boolean }) {
  const { t } = usePlanT();
  const pm = usePlanMonth();
  const ys = byYear(projectMonths(p));
  const staffY1 = (r: PlanStaff) => r.count * r.salary * Math.max(0, 13 - Math.max(1, r.fromMonth));
  const staffCols: Col<PlanStaff>[] = [
    { key: "name", label: t("Role"), kind: "text", width: "24%" },
    { key: "count", label: t("People"), kind: "num", min: 0 },
    { key: "salary", label: t("Monthly salary, each"), kind: "num", min: 0 },
    { key: "raise", label: t("Yearly raise"), kind: "num", suffix: "%" },
    { key: "fromMonth", label: t("From month"), kind: "num", min: 1, hint: (r) => pm(p, r.fromMonth) },
    { key: "y1", label: t("Cost in Y1"), kind: "calc", calc: (r) => wm(staffY1(r), cur), total: wm(p.staff.reduce((s, r) => s + staffY1(r), 0), cur) },
  ];
  const expCols: Col<PlanExpense>[] = [
    { key: "name", label: t("Overhead"), kind: "text", width: "34%" },
    { key: "monthly", label: t("A month"), kind: "num", min: 0 },
    { key: "growth", label: t("Yearly growth"), kind: "num", suffix: "%" },
    { key: "y1", label: t("Cost in Y1"), kind: "calc", calc: (r) => wm(r.monthly * 12, cur), total: wm(p.expenses.reduce((s, r) => s + r.monthly * 12, 0), cur) },
  ];
  const labels = ys.map((y) => y.label);
  const parts = [["cogs", "Cost of sales"], ["staff", "Staff"], ["overheads", "Overheads"], ["depreciation", "Depreciation"], ["interest", "Interest"]] as const;
  const y1 = ys[0];
  return (
    <div className="space-y-4" data-testid="plan-costs">
      <Impact p={p} opened={opened} cur={cur} />
      <Editor title={t("Staff")} rows={p.staff} cols={staffCols} readOnly={readOnly} onChange={(staff) => set({ staff })} testId="plan-staff"
        make={() => ({ id: rid("ps"), name: t("New role"), count: 1, salary: 0, raise: 10, fromMonth: 1 })} addLabel={t("Add a role")} emptyLabel={t("Add your first role")} />
      <Editor title={t("Overheads")} rows={p.expenses} cols={expCols} readOnly={readOnly} onChange={(expenses) => set({ expenses })} testId="plan-expenses"
        make={() => ({ id: rid("pe"), name: t("New overhead"), monthly: 0, growth: 10 })} addLabel={t("Add an overhead")} emptyLabel={t("Add your first overhead")} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title={t("Costs by year")} table={{ head: [t("Cost"), ...labels], rows: parts.map(([k, l]) => [t(l), ...ys.map((y) => wm(y[k], cur))]) }} testId="plan-costs-chart">
          <ColumnChart stacked labels={labels} cur={cur} height={240} series={parts.map(([k, l], i) => ({ name: t(l), values: ys.map((y) => y[k]), color: ramp(parts.length)[i] }))} />
        </ChartCard>
        <ChartCard title={t("Where each pound of sales goes")} sub={t("Year {year}", { year: y1?.label ?? "" })} testId="plan-pound">
          {y1 && y1.revenue > 0 ? <ShareBar cur={cur} label={t("Where each pound of sales goes")} parts={[...parts.map(([k, l]) => ({ label: t(l), value: y1[k] })), { label: t("Income tax"), value: y1.tax }, { label: t("Net profit"), value: Math.max(0, y1.net) }]} /> : <p className="text-sm text-mute">{t("Add sales first.")}</p>}
        </ChartCard>
      </div>
    </div>
  );
}

export function FundingTab({ p, set, opened, cur, readOnly }: { p: BusinessPlan; set: SetPlan; opened: BusinessPlan; cur: string; readOnly: boolean }) {
  const { t } = usePlanT();
  const pm = usePlanMonth();
  const o = p.opening;
  const equity0 = o.cash + o.receivables + o.inventory + o.fixedAssets + o.otherAssets - o.payables - o.otherLiabilities - openingLoans(p);
  const field = (k: keyof PlanOpening, label: string) => (
    <label className="block text-[13px]"><span className="mb-1 block text-mute">{label}</span>
      <NumIn label={label} value={o[k]} disabled={readOnly || k === "loans"} onChange={(v) => set({ opening: { ...o, [k]: v } })} testId={`plan-open-${k}`} /></label>
  );
  const capexCols: Col<PlanCapex>[] = [
    { key: "name", label: t("Investment"), kind: "text", width: "30%" },
    { key: "amount", label: t("Amount"), kind: "num", min: 0 },
    { key: "month", label: t("Month"), kind: "num", min: 1, hint: (r) => pm(p, r.month) },
    { key: "lifeYears", label: t("Life (years)"), kind: "num", min: 0 },
    { key: "dep", label: t("Depreciation a year"), kind: "calc", calc: (r) => wm(r.lifeYears > 0 ? r.amount / r.lifeYears : 0, cur) },
  ];
  const loanCols: Col<PlanLoan>[] = [
    { key: "name", label: t("Loan"), kind: "text", width: "22%" },
    { key: "amount", label: t("Amount"), kind: "num", min: 0 },
    { key: "month", label: t("Month"), kind: "num", min: 0, hint: (r) => pm(p, r.month) },
    { key: "rate", label: t("Interest"), kind: "num", suffix: "%" },
    { key: "termMonths", label: t("Repaid over (months)"), kind: "num", min: 1 },
    { key: "graceMonths", label: t("Grace (months)"), kind: "num", min: 0 },
    { key: "pay", label: t("Monthly instalment"), kind: "calc", calc: (r) => wm(loanPayment(r), cur) },
  ];
  const eqCols: Col<PlanEquity>[] = [
    { key: "name", label: t("Capital"), kind: "text", width: "40%" },
    { key: "amount", label: t("Amount"), kind: "num", min: 0 },
    { key: "month", label: t("Month"), kind: "num", min: 1, hint: (r) => pm(p, r.month) },
  ];
  const setLoans = (loans: PlanLoan[]) => set({ loans, opening: { ...o, loans: openingLoans({ loans }) } });
  return (
    <div className="space-y-4" data-testid="plan-funding">
      <Impact p={p} opened={opened} cur={cur} />
      <section className="rounded-xl border border-line bg-white p-4">
        <h3 className="t-card">{t("The position at the start")}</h3>
        <p className="t-cap mb-3">{t("Balances on the day before the plan starts. Loans come from the loans owed at the start (month 0).")}</p>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {field("cash", t("Cash and bank"))}{field("receivables", t("Customers owe"))}{field("inventory", t("Stock"))}{field("fixedAssets", t("Fixed assets"))}
          {field("otherAssets", t("Other assets"))}{field("payables", t("Owed to suppliers"))}{field("otherLiabilities", t("Other liabilities"))}{field("loans", t("Loans"))}
        </div>
        <p className="mt-3 text-[13px]">{t("Equity at the start")}: <b className={cn("num", equity0 < 0 && "text-red")} data-testid="plan-equity0">{wm(equity0, cur)}</b></p>
      </section>
      <Editor title={t("Investments")} rows={p.capex} cols={capexCols} readOnly={readOnly} onChange={(capex) => set({ capex })} testId="plan-capex"
        make={() => ({ id: rid("pc"), name: t("New investment"), amount: 0, month: 1, lifeYears: 5 })} addLabel={t("Add an investment")} emptyLabel={t("Add an investment")} />
      <Editor title={t("Loans")} rows={p.loans} cols={loanCols} readOnly={readOnly} onChange={setLoans} testId="plan-loans"
        make={() => ({ id: rid("pn"), name: t("New loan"), amount: 0, month: 1, rate: 20, termMonths: 36, graceMonths: 0 })} addLabel={t("Add a loan")} emptyLabel={t("Add a loan")} />
      <Editor title={t("Capital put in")} rows={p.equity} cols={eqCols} readOnly={readOnly} onChange={(equity) => set({ equity })} testId="plan-equity"
        make={() => ({ id: rid("pq"), name: t("Capital"), amount: 0, month: 1 })} addLabel={t("Add capital")} emptyLabel={t("Add capital")} />
      <section className="rounded-xl border border-line bg-white p-4">
        <h3 className="t-card mb-3">{t("Cash timing and tax")}</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          {([["receivableDays", "Customers pay after (days)"], ["payableDays", "Suppliers are paid after (days)"], ["stockDays", "Stock kept (days)"], ["taxRate", "Income tax %"], ["discountRate", "Discount rate %"], ["openingAssetLife", "Life of assets owned (years)"]] as const).map(([k, l]) => (
            <label key={k} className="block text-[13px]"><span className="mb-1 block text-mute">{t(l)}</span><NumIn label={t(l)} value={p[k]} min={0} disabled={readOnly} onChange={(v) => set({ [k]: v } as Partial<BusinessPlan>)} testId={`plan-${k}`} /></label>
          ))}
        </div>
      </section>
    </div>
  );
}

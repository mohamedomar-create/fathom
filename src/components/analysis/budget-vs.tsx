"use client";
import { useMemo, useState } from "react";
import { hasPL, pct, plCalc, PL_KEYS, type PLInput } from "@/lib/engine";
import { budgetAccounts, budgetComparison, productVariance, varianceRows, type BudgetLine, type BudgetProduct } from "@/lib/engine/budget";
import type { SalesProductRow } from "@/lib/engine/sales";
import { useCompany } from "@/lib/company/context";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/use-t";
import { LineChart } from "@/components/charts/line-chart";
import { C } from "@/components/charts/util";
import { Amt, ChartCard, useCompact } from "./budget-visuals";

const PLS = new Set<string>(PL_KEYS);
const INCOME = new Set<string>(["revenue", "other_income", "interest_income"]);

/** A difference against budget: income above it and costs below it are better (green), the other way worse (red). */
function VarCell({ income, cur, cmp, text }: { income: boolean; cur: number; cmp: number; text: React.ReactNode }) {
  const { d } = useT();
  const diff = cur - cmp;
  const tone = Math.abs(diff) < 1 ? "neutral" : (income ? diff > 0 : diff < 0) ? "better" : "worse";
  return (
    <td className={cn(tone !== "neutral" && `tone-${tone}`)} data-tone={tone}>
      {diff !== 0 && <span aria-hidden className="me-1 text-[10px]">{diff > 0 ? "▲" : "▼"}</span>}{text}
      {tone !== "neutral" && <span className="sr-only"> ({tone === "better" ? d.hl.better : d.hl.worse})</span>}
    </td>
  );
}
/** The day the books stop on, when that is inside month `m` (a part month); else undefined. */
const partDayOf = (asOf: string | null | undefined, m: string) => (asOf && asOf.startsWith(m) ? Number(asOf.slice(8)) : undefined);

/** Budget vs actual for one version's lines and products: by account (month and year to date) and products' volume and price. */
export function BudgetVs({ lines, products, months, versionName, salesProducts }: {
  lines: BudgetLine[]; products: BudgetProduct[]; months: string[]; versionName: string; salesProducts: SalesProductRow[];
}) {
  const c = useCompany();
  const { lang, d, ml, ms } = useT();
  const short = useCompact();
  const t = d.bud;
  const clsName = d.setx.coa.cls as Record<string, string>;
  const fyStart = c.settings.fyStartMonth ?? 1;
  const budget = useMemo(() => budgetAccounts(lines, products).accounts, [lines, products]);
  const lastActual = c.months.filter(hasPL).map((m) => m.period).filter((p) => months.includes(p)).pop() ?? null;
  const [end, setEnd] = useState<string | null>(null);
  const upTo = end && months.includes(end) ? end : lastActual;
  const rows = useMemo(() => (upTo ? varianceRows(c.accounts, budget, months, upTo, partDayOf(c.asOf, upTo)) : [])
    .sort((a, b) => PL_KEYS.indexOf(a.cls as never) - PL_KEYS.indexOf(b.cls as never) || a.label.localeCompare(b.label)), [c.accounts, budget, months, upTo, c.asOf]);
  const pv = useMemo(() => (upTo ? productVariance(products, salesProducts, months.filter((m) => m <= upTo)) : []), [products, salesProducts, months, upTo]);
  const fmt = (v: number) => <Amt v={v} />;
  // Revenue by month: the budget for every month, the actual up to the month chosen.
  const revenue = useMemo(() => {
    const bud = months.map((m) => budget.filter((a) => a.cls === "revenue").reduce((s, a) => s + (a.amounts[m] ?? 0), 0));
    const act = months.map((m) => (upTo && m <= upTo ? c.accounts.filter((a) => a.cls === "revenue").reduce((s, a) => s + (a.amounts[m] ?? 0), 0) : null));
    return { bud, act };
  }, [budget, months, upTo, c.accounts]);

  // Net profit year to date: actual against budget, through the same statements.
  const head = useMemo(() => {
    if (!upTo) return null;
    const b = budgetComparison(budget, { type: "year", end: upTo }, fyStart, versionName, partDayOf(c.asOf, upTo)).P;
    const ytd = months.filter((m) => m <= upTo);
    const pl: PLInput = {};
    for (const a of c.accounts) if (PLS.has(a.cls)) for (const m of ytd) pl[a.cls as keyof PLInput] = (pl[a.cls as keyof PLInput] ?? 0) + (a.amounts[m] ?? 0);
    const a = plCalc(pl);
    return { a: a.net_income, b: b.net_income };
  }, [budget, upTo, fyStart, versionName, months, c.accounts, c.asOf]);

  if (!upTo) return <p className="text-sm text-mute" data-testid="budget-no-actual">{t.noActual}</p>;
  return (
    <div data-testid="budget-vs">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="budget-upto">{t.upTo}</label>
        <select id="budget-upto" className="rounded border border-line bg-white px-2 py-1" value={upTo} onChange={(e) => setEnd(e.target.value)}>
          {months.filter((m) => !lastActual || m <= lastActual).map((m) => <option key={m} value={m}>{ml(m)}</option>)}
        </select>
      </div>
      <ChartCard testId="bchart-vs" title={t.b.charts.vs} summary={months.map((m, i) => `${ms(m)}: ${t.budget} ${short(revenue.bud[i])}${revenue.act[i] === null ? "" : `, ${t.actual} ${short(revenue.act[i]!)}`}`).join("; ")}>
        <LineChart labels={months.map(ms)} cur={c.settings.currency} height={220}
          series={[{ name: t.budget, values: revenue.bud, color: C.s[0], dashed: true, dots: false }, { name: t.actual, values: revenue.act, color: C.s[1] }]} />
      </ChartCard>
      {head && head.b !== 0 && (
        <p className="mb-3 text-lg" data-testid="budget-headline">
          {t.headline(pct(Math.abs(((head.a - head.b) / Math.abs(head.b)) * 100), 1), head.a >= head.b ? t.above : t.below)}
        </p>
      )}
      <div tabIndex={0} className="overflow-x-auto">
        <table className="tbl text-[13px]">
          <thead>
            <tr><th>{t.account}</th><th>{t.monthCol} · {t.actual}</th><th>{t.budget}</th><th>{t.diff}</th><th>{t.ytdCol} · {t.actual}</th><th>{t.budget}</th><th>{t.diff}</th><th>%</th><th title={t.outlookHint}>{t.outlook}</th><th>{t.fullYear}</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} data-testid="budget-vs-row" data-key={r.key} data-tone={r.tone}>
                <td>{r.key.startsWith("class:") ? clsName[r.cls] : r.label}</td>
                <td>{fmt(r.month.actual)}</td><td>{fmt(r.month.budget)}</td>
                <VarCell income={INCOME.has(r.cls)} cur={r.month.actual} cmp={r.month.budget} text={fmt(r.month.diff)} />
                <td>{fmt(r.ytd.actual)}</td><td>{fmt(r.ytd.budget)}</td>
                <VarCell income={INCOME.has(r.cls)} cur={r.ytd.actual} cmp={r.ytd.budget} text={fmt(r.ytd.diff)} />
                <VarCell income={INCOME.has(r.cls)} cur={r.ytd.actual} cmp={r.ytd.budget} text={r.ytd.pct === null ? "–" : pct(r.ytd.pct, 1)} />
                <td>{fmt(r.outlook)}</td><td>{fmt(r.fullYear)}</td>
              </tr>
            ))}
            {head && <tr className="tot"><td>{t.profit}</td><td /><td /><td /><td>{fmt(head.a)}</td><td>{fmt(head.b)}</td><VarCell income cur={head.a} cmp={head.b} text={fmt(head.a - head.b)} /><VarCell income cur={head.a} cmp={head.b} text={head.b ? pct(((head.a - head.b) / Math.abs(head.b)) * 100) : "–"} /><td /><td /></tr>}
          </tbody>
        </table>
      </div>
      {pv.length > 0 && (
        <section className="mt-6" data-testid="budget-pv">
          <h2 className="mb-1 text-lg font-light">{t.productsVs}</h2>
          <p className="mb-2 text-xs text-mute">{t.volumeHint}</p>
          <div tabIndex={0} className="overflow-x-auto">
            <table className="tbl text-[13px]">
              <thead><tr><th>{t.product}</th><th>{t.units} · {t.budget}</th><th>{t.units} · {t.actual}</th><th>{t.budget}</th><th>{t.actual}</th><th>{t.volume}</th><th>{t.priceEff}</th></tr></thead>
              <tbody>
                {pv.slice(0, 50).map((p) => (
                  <tr key={p.product}><td>{p.product}</td><td>{p.budgetUnits.toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}</td><td>{p.actualUnits === null ? "–" : p.actualUnits.toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}</td>
                    <td>{fmt(p.budget)}</td><td>{fmt(p.actual)}</td><td>{p.volume === null ? t.unexplained : fmt(p.volume)}</td><td>{p.price === null ? "–" : fmt(p.price)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

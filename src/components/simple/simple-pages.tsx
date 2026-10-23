"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Info } from "lucide-react";
import { money, pct } from "@/lib/engine";
import { AGE_BUCKETS, SIMPLE_DEF, simpleFindings, simpleSummary, type Fig, type SimpleSummary } from "@/lib/engine/simple";
import { useCompany } from "@/lib/company/context";
import { useSimpleLines } from "@/lib/company/simple-context";
import { PageHeader } from "@/components/shell/page-header";
import { LineChart } from "@/components/charts/line-chart";
import { ColumnChart } from "@/components/charts/column-chart";
import { BarList } from "@/components/charts/bar-list";
import { C } from "@/components/charts/util";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Delta } from "@/components/ui/status";
import { useT } from "@/lib/i18n/use-t";
import { cn } from "@/lib/cn";

/** Every Simple figure for the company, worked out once per page from its lines. */
function useSimple(): SimpleSummary | null {
  const c = useCompany();
  const { lines, asOf } = useSimpleLines();
  const T = useT();
  return useMemo(() => (lines.sales.length || lines.expenses.length
    ? simpleSummary({ sales: lines.sales, expenses: lines.expenses, openingCash: c.openingCash ?? null, asOf, lang: T.lang })
    : null), [lines, asOf, c.openingCash, T.lang]);
}

/** A figure's formula and meaning, opened from its tile. */
function Details({ defKey, onClose }: { defKey: string; onClose: () => void }) {
  const T = useT();
  const t = T.d.simple;
  const d = SIMPLE_DEF[defKey];
  if (!d) return null;
  const x = T.lang === "ar" ? d.ar : d;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={x.name} className="w-[min(560px,calc(100vw-24px))]">
        <div className="p-6" data-testid="simple-details">
          <h2 className="mb-3 pe-8 text-2xl font-normal">{x.name}</h2>
          <div className="label">{t.formula}</div>
          <p className="mb-4 rounded bg-band px-3 py-2 font-mono text-xs" data-testid="simple-formula">{x.formula}</p>
          <div className="label">{t.definition}</div>
          <p className="text-[13.5px] leading-relaxed">{x.about}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One figure: its value, or what it needs (never a 0 standing in for missing data). The label opens its formula.
 */
function Tile<V>({ label, fig, show, sub, defKey, neg, testId }: { label: string; fig: Fig<V>; show: (v: V) => string; sub?: React.ReactNode; defKey: string; neg?: (v: V) => boolean; testId: string }) {
  const t = useT().d.simple;
  const [open, setOpen] = useState(false);
  const bad = fig.ok && neg ? neg(fig.value) : false;
  return (
    <div className={cn("fade-up border-t-[3px] pt-2.5", !fig.ok ? "border-line" : bad ? "border-red" : "border-green")} data-testid={testId} data-needs={fig.ok ? undefined : fig.needs}>
      <button type="button" onClick={() => setOpen(true)} className="label flex items-center gap-1 text-start hover:text-ink" title={t.details}>
        {label}<Info className="h-3 w-3 shrink-0" aria-hidden />
      </button>
      {fig.ok ? <>
        <div className="num my-0.5 whitespace-nowrap text-[21px]">{show(fig.value)}</div>
        {sub && <div className="text-xs">{sub}</div>}
      </> : <div className="mt-1 text-[13px] text-mute" data-testid={`${testId}-needs`}>{t.needs[fig.needs] ?? fig.needs}</div>}
      {open && <Details defKey={defKey} onClose={() => setOpen(false)} />}
    </div>
  );
}

function NoLines() {
  const c = useCompany();
  const t = useT().d.simple;
  return (
    <div className="mx-auto max-w-xl py-12 text-center" data-testid="simple-empty">
      <h2 className="mb-2 text-2xl font-light">{t.noLines}</h2>
      <p className="mb-5 text-mute">{t.noLinesText}</p>
      {!c.readOnly && <div className="flex flex-wrap justify-center gap-3">
        <Link prefetch={false} href={`${c.basePath}/data/upload?step=sales`} className="inline-block rounded bg-brand-d px-5 py-2.5 font-medium text-white" data-testid="simple-upload-sales">{t.uploadSales}</Link>
        <Link prefetch={false} href={`${c.basePath}/data/upload?step=expenses`} className="inline-block rounded border border-brand-d px-5 py-2.5 font-medium text-brand-d" data-testid="simple-upload-expenses">{t.uploadExpenses}</Link>
      </div>}
      <p className="mt-4 text-xs text-mute">{t.templates}</p>
    </div>
  );
}

const ok = <V,>(v: V): Fig<V> => ({ ok: true, value: v });

export function SimpleOverview() {
  const c = useCompany();
  const T = useT();
  const t = T.d.simple;
  const s = useSimple();
  const { lines } = useSimpleLines();
  const cur = c.settings.currency;
  if (!s) return <><PageHeader title={t.overview} /><NoLines /></>;
  const P = s.pl.total;
  const bullets = simpleFindings(s, cur, T.lang);
  const last12 = s.monthly.slice(-12);
  const channels = new Map<string, number>();
  for (const l of lines.sales) if (l.channel && s.window.includes(l.period)) channels.set(l.channel, (channels.get(l.channel) ?? 0) + l.amount);
  const sumCh = [...channels.values()].reduce((a, b) => a + b, 0);
  const fixed = P.exp_fixed, variable = P.exp_variable + P.cos_variable;
  return (
    <>
      <PageHeader title={t.overview} right={<span className="text-sm text-mute">{t.window(T.ml(s.window[0]), T.ml(s.window[s.window.length - 1]))}</span>} />
      {!lines.full && <p className="mb-4 rounded bg-amber/10 px-4 py-2 text-[13px]" data-testid="simple-old-db">{t.oldDb}</p>}
      <div className="mb-8 max-w-4xl" data-testid="simple-summary">
        <h3 className="mb-2 text-lg font-normal">{t.summary}</h3>
        <ul className="ms-5 list-disc space-y-1.5 text-[15.5px] leading-relaxed">{bullets.map((b) => <li key={b}>{b}</li>)}</ul>
      </div>
      <div className="mb-8 grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
        <Tile label={t.revenue} fig={ok(P.revenue)} show={(v) => money(v, cur)} defKey="revenue" testId="simple-revenue"
          sub={s.latest && s.mom.ok ? <><Delta value={s.mom.value} /> <span className="text-mute">{t.vsPrev(T.ms(s.latest))}</span>{s.yoy.ok && <><br /><Delta value={s.yoy.value} /> <span className="text-mute">{t.vsLy(T.ms(s.latest))}</span></>}</> : undefined} />
        <Tile label={t.netProfit} fig={ok(P.net_income)} show={(v) => money(v, cur)} neg={(v) => v < 0} defKey="net_profit" testId="simple-net-profit" />
        <Tile label={t.netMargin} fig={s.pl.netMargin === null ? { ok: false, needs: "revenue" } : ok(s.pl.netMargin)} show={(v) => `${pct(v, 1)}%`} neg={(v) => v < 0} defKey="net_margin" testId="simple-net-margin" />
        <Tile label={t.grossMargin} fig={s.pl.grossMargin.ok ? ok(s.pl.grossMargin.value) : { ok: false, needs: s.pl.grossMargin.needs }} show={(v) => `${pct(v, 1)}%`} defKey="gross_margin" testId="simple-gross-margin" />
        <Tile label={t.cash} fig={s.cash.balance} show={(v) => money(v, cur)} neg={(v) => v < 0} defKey="cash" testId="simple-cash" />
        <Tile label={t.burn} fig={s.cash.burn} show={(v) => (v ? `${money(v, cur)} ${t.perMonth}` : t.notBurning)} neg={(v) => v > 0} defKey="burn" testId="simple-burn" />
        <Tile label={t.runway} fig={s.cash.runway} show={(v) => t.months(v.toFixed(1))} neg={(v) => v < 6} defKey="runway" testId="simple-runway" />
        <Tile label={t.breakeven} fig={s.pl.breakeven.ok ? ok(s.pl.breakeven.bep) : { ok: false, needs: "revenue" }} show={(v) => money(v, cur)} defKey="breakeven" testId="simple-breakeven"
          sub={s.pl.breakeven.ok ? <span className="text-mute">{t.atMargin(`${pct(s.pl.breakeven.vcr * 100, 0)}%`)}</span> : undefined} />
      </div>
      <div className="grid gap-10 lg:grid-cols-2">
        <div>
          <h3 className="mb-1 text-lg font-normal">{t.trend}</h3>
          <LineChart labels={last12.map((x) => T.ms(x.period))} cur={cur} height={260} testId="simple-trend"
            series={[
              { name: t.revenueLine, values: last12.map((x) => x.revenue), color: C.s[0], fill: true },
              { name: t.expensesLine, values: last12.map((x) => x.expenses), color: C.s[1] },
            ]} />
          <h3 className="mb-2 mt-8 text-lg font-normal">{t.byCategory}</h3>
          <BarList items={s.categories.map((x) => ({ key: x.name, label: x.name, value: x.amount }))} cur={cur} max={8} testId="simple-categories" />
          {fixed + variable > 0 && <>
            <h3 className="mb-2 mt-8 text-lg font-normal">{t.fixedVar}</h3>
            <BarList items={[{ key: "fixed", label: t.fixed, value: fixed, share: (fixed / (fixed + variable)) * 100 }, { key: "variable", label: t.variable, value: variable, share: (variable / (fixed + variable)) * 100 }]} cur={cur} testId="simple-fixed-variable" />
          </>}
          {channels.size > 0 && <>
            <h3 className="mb-2 mt-8 text-lg font-normal">{t.byChannel}</h3>
            <BarList items={[...channels].map(([k, v]) => ({ key: k, label: k, value: v, share: sumCh ? (v / sumCh) * 100 : 0 }))} cur={cur} testId="simple-channels" />
          </>}
        </div>
        <div>
          <h3 className="mb-3 text-lg font-normal">{t.risk}</h3>
          <div className="mb-6 grid grid-cols-2 gap-6">
            <Tile label={t.top1} fig={s.concentration.ok ? ok(s.concentration.value.top1) : { ok: false, needs: s.concentration.needs }} show={(v) => `${pct(v.share, 1)}%`}
              sub={s.concentration.ok ? <span className="text-mute">{s.concentration.value.top1.name}</span> : undefined} neg={(v) => v.share > 30} defKey="top1" testId="simple-top1" />
            <Tile label={t.top5} fig={s.concentration.ok ? ok(s.concentration.value.top5) : { ok: false, needs: s.concentration.needs }} show={(v) => `${pct(v, 1)}%`} neg={(v) => v > 70} defKey="top5" testId="simple-top5" />
          </div>
          <Tile label={t.seasonality} fig={s.seasonality} show={(v) => t.peakLow(T.ms(`2000-${String(v.peak).padStart(2, "0")}`).slice(0, -3), T.ms(`2000-${String(v.low).padStart(2, "0")}`).slice(0, -3))} defKey="seasonality" testId="simple-seasonality" />
          {s.seasonality.ok && <div className="mt-2">
            <p className="mb-1 text-xs text-mute">{t.seasonIndex}</p>
            <ColumnChart labels={s.seasonality.value.index.map((_, i) => T.ms(`2000-${String(i + 1).padStart(2, "0")}`).slice(0, -3))} unit="num" height={180} testId="simple-season-chart"
              series={[{ name: t.seasonality, values: s.seasonality.value.index.map((v) => Math.round(v * 100) / 100), color: C.s[2] }]} />
          </div>}
          <h3 className="mb-3 mt-8 text-lg font-normal">{t.ageing}</h3>
          <AgeingTable s={s} cur={cur} />
        </div>
      </div>
      <p className="mt-8 text-xs text-mute">{t.assumptions}</p>
    </>
  );
}

function AgeingTable({ s, cur }: { s: SimpleSummary; cur: string }) {
  const t = useT().d.simple;
  const rows = [{ key: "receivables", label: t.receivables, fig: s.receivables }, { key: "payables", label: t.payables, fig: s.payables }];
  if (!rows.some((r) => r.fig.ok)) return <Tile label={t.receivables} fig={s.receivables} show={() => ""} defKey="receivables" testId="simple-ageing" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="simple-ageing">
        <thead><tr className="border-b border-line text-start text-xs text-mute"><th className="py-1.5 text-start font-normal">{t.bucket}</th>{AGE_BUCKETS.map((b) => <th key={b} className="py-1.5 text-end font-normal">{b}</th>)}<th className="py-1.5 text-end font-normal">{t.total}</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-line/60" data-testid={`simple-ageing-${r.key}`}>
              <td className="py-1.5">{r.label}</td>
              {r.fig.ok ? <>{r.fig.value.buckets.map((v, i) => <td key={i} className={cn("num py-1.5 text-end", i >= 2 && v > 0 && "text-red")}>{money(v, cur)}</td>)}<td className="num py-1.5 text-end">{money(r.fig.value.total, cur)}</td></>
                : <td colSpan={5} className="py-1.5 text-end text-xs text-mute">{t.needs[r.fig.needs]}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SimpleCash() {
  const c = useCompany();
  const T = useT();
  const t = T.d.simple;
  const s = useSimple();
  const cur = c.settings.currency;
  if (!s) return <><PageHeader title={t.cashTitle} /><NoLines /></>;
  const cm = s.cash.months.slice(-12);
  const hasBalance = cm.some((m) => m.balance !== null);
  return (
    <>
      <PageHeader title={t.cashTitle} />
      <div className="mb-8 grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-3">
        <Tile label={t.cash} fig={s.cash.balance} show={(v) => money(v, cur)} neg={(v) => v < 0} defKey="cash" testId="simple-cash" />
        <Tile label={t.burn} fig={s.cash.burn} show={(v) => (v ? `${money(v, cur)} ${t.perMonth}` : t.notBurning)} neg={(v) => v > 0} defKey="burn" testId="simple-burn" />
        <Tile label={t.runway} fig={s.cash.runway} show={(v) => t.months(v.toFixed(1))} neg={(v) => v < 6} defKey="runway" testId="simple-runway" />
      </div>
      {s.cash.assumedPaid.lines > 0 && <p className="mb-6 rounded bg-band px-4 py-2 text-[13px]" data-testid="simple-assumed">{t.assumed(s.cash.assumedPaid.lines, money(s.cash.assumedPaid.amount, cur))}</p>}
      <div className="grid gap-10 lg:grid-cols-2">
        <div>
          <h3 className="mb-1 text-lg font-normal">{t.cashInOut}</h3>
          <ColumnChart labels={cm.map((m) => T.ms(m.period))} cur={cur} height={260} testId="simple-cash-chart"
            series={[{ name: t.cashIn, values: cm.map((m) => m.in), color: C.green }, { name: t.cashOut, values: cm.map((m) => -m.out), color: C.red }]} />
          {hasBalance && <>
            <h3 className="mb-1 mt-8 text-lg font-normal">{t.balance}</h3>
            <LineChart labels={cm.map((m) => T.ms(m.period))} cur={cur} height={220} testId="simple-balance-chart" series={[{ name: t.balance, values: cm.map((m) => m.balance), color: C.s[0], fill: true }]} />
          </>}
        </div>
        <div>
          <ForecastBlock title={t.forecastRevenue} fig={s.forecastRevenue} history={s.monthly.filter((m) => m.period < s.asOf.slice(0, 7)).map((m) => ({ period: m.period, value: m.revenue }))} cur={cur} testId="simple-forecast-revenue" />
          <div className="mt-8"><ForecastBlock title={t.forecastExpenses} fig={s.forecastExpenses} history={s.monthly.filter((m) => m.period < s.asOf.slice(0, 7)).map((m) => ({ period: m.period, value: m.expenses }))} cur={cur} testId="simple-forecast-expenses" /></div>
        </div>
      </div>
      <p className="mt-8 text-xs text-mute">{t.assumptions}</p>
    </>
  );
}

function ForecastBlock({ title, fig, history, cur, testId }: { title: string; fig: SimpleSummary["forecastRevenue"]; history: { period: string; value: number }[]; cur: string; testId: string }) {
  const T = useT();
  const t = T.d.simple;
  const [open, setOpen] = useState(false);
  if (!fig.ok) return <div data-testid={testId}><h3 className="mb-1 text-lg font-normal">{title}</h3><p className="text-[13px] text-mute" data-testid={`${testId}-needs`}>{t.needs[fig.needs]}</p></div>;
  const f = fig.value;
  const hist = history.slice(-6);
  const labels = [...hist.map((h) => T.ms(h.period)), ...f.points.map((p) => T.ms(p.period))];
  const pad = (n: number) => new Array(n).fill(null) as null[];
  return (
    <div data-testid={testId}>
      <button type="button" onClick={() => setOpen(true)} className="mb-1 flex items-center gap-1 text-lg font-normal hover:underline">{title}<Info className="h-3.5 w-3.5 text-mute" aria-hidden /></button>
      <LineChart labels={labels} cur={cur} height={240}
        series={[
          { name: t.actual, values: [...hist.map((h) => h.value), ...pad(f.points.length)], color: C.s[0], fill: true },
          { name: t.forecast, values: [...pad(hist.length - 1), hist.length ? hist[hist.length - 1].value : null, ...f.points.map((p) => p.value)].slice(0, labels.length), color: C.s[0], dashed: true },
          { name: t.low, values: [...pad(hist.length), ...f.points.map((p) => p.low)], color: C.mute, dashed: true, dots: false },
          { name: t.high, values: [...pad(hist.length), ...f.points.map((p) => p.high)], color: C.mute, dashed: true, dots: false },
        ]} />
      <p className="mt-2 text-[13px]" data-testid={`${testId}-method`}>{t.method(f.methodLabel)} <span className="text-mute">{f.methodAbout}</span></p>
      <p className="text-[13px] text-mute">{f.backtestError !== null && f.testedMonths ? t.tested(`${pct(f.backtestError, 1)}%`, f.testedMonths) : t.untested}</p>
      {open && <Details defKey="forecast" onClose={() => setOpen(false)} />}
    </div>
  );
}

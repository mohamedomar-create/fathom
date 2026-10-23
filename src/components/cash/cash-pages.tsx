"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Info } from "lucide-react";
import { money, pct } from "@/lib/engine/format";
import { cashFigures, cashForecast, cashSummary, CASH_DEF, type CashFigures, type Fig, type Range, type Unpaid } from "@/lib/cash/figures";
import { useCash } from "@/lib/cash/context";
import { PageHeader } from "@/components/shell/page-header";
import { ColumnChart } from "@/components/charts/column-chart";
import { LineChart } from "@/components/charts/line-chart";
import { BarList } from "@/components/charts/bar-list";
import { C } from "@/components/charts/util";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Delta } from "@/components/ui/status";
import { useT } from "@/lib/i18n/use-t";
import { cn } from "@/lib/cn";

const RANGES: Range[] = ["month", "3m", "12m", "all"];

function useFigures(): { f: CashFigures; range: Range } {
  const { company, entries } = useCash();
  const r = useSearchParams().get("range");
  const range: Range = RANGES.includes(r as Range) ? (r as Range) : "12m";
  const f = useMemo(() => cashFigures(entries, { opening: company.openingCash, today: company.today, range }), [entries, company.openingCash, company.today, range]);
  return { f, range };
}

function RangePicker({ range }: { range: Range }) {
  const t = useT().d.cash;
  const path = usePathname();
  return (
    <div className="flex flex-wrap gap-1" data-testid="cash-range">
      {RANGES.map((k) => <Link prefetch={false} key={k} href={`${path}?range=${k}`} className={cn("rounded px-3 py-1 text-sm", k === range ? "bg-brand-d text-white" : "border border-line hover:bg-band")} data-testid={`range-${k}`}>{t.range[k]}</Link>)}
    </div>
  );
}

function Formula({ k, onClose }: { k: string; onClose: () => void }) {
  const T = useT();
  const d = CASH_DEF[k];
  if (!d) return null;
  const x = T.lang === "ar" ? d.ar : d;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={x.name} className="w-[min(520px,calc(100vw-24px))]">
        <div className="p-6" data-testid="cash-formula">
          <h2 className="mb-3 pe-8 text-xl font-normal">{x.name}</h2>
          <div className="label">{T.d.cash.formula}</div>
          <p className="rounded bg-band px-3 py-2 font-mono text-xs">{x.formula}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** One figure, or what it needs (never a 0 standing in for missing data). The label opens its formula. */
function Tile<V>({ label, fig, show, k, neg, sub, testId }: { label: string; fig: Fig<V>; show: (v: V) => string; k: string; neg?: (v: V) => boolean; sub?: React.ReactNode; testId: string }) {
  const t = useT().d.cash;
  const [open, setOpen] = useState(false);
  const bad = fig.ok && neg ? neg(fig.value) : false;
  return (
    <div className={cn("border-t-[3px] pt-2.5", !fig.ok ? "border-line" : bad ? "border-red" : "border-green")} data-testid={testId} data-needs={fig.ok ? undefined : fig.needs}>
      <button type="button" onClick={() => setOpen(true)} className="label flex items-center gap-1 text-start hover:text-ink">{label}<Info className="h-3 w-3" aria-hidden /></button>
      {fig.ok ? <><div className="num my-0.5 whitespace-nowrap text-[21px]">{show(fig.value)}</div>{sub && <div className="text-xs">{sub}</div>}</>
        : <div className="mt-1 text-[13px] text-mute">{t.needs[fig.needs] ?? fig.needs}</div>}
      {open && <Formula k={k} onClose={() => setOpen(false)} />}
    </div>
  );
}
const ok = <V,>(v: V): Fig<V> => ({ ok: true, value: v });

function Empty() {
  const { company } = useCash();
  const t = useT().d.cash;
  return (
    <div className="mx-auto max-w-xl py-14 text-center" data-testid="cash-empty">
      <h2 className="mb-2 text-2xl font-light">{t.empty}</h2>
      <p className="mb-5 text-mute">{t.emptyText}</p>
      {!company.readOnly && <div className="flex flex-wrap justify-center gap-3">
        <Link prefetch={false} href={`/cash/${company.id}/upload`} className="rounded bg-brand-d px-5 py-2.5 font-medium text-white" data-testid="cash-go-upload">{t.upload}</Link>
        <Link prefetch={false} href={`/cash/${company.id}/entries`} className="rounded border border-brand-d px-5 py-2.5 font-medium text-brand-d">{t.addEntry}</Link>
      </div>}
    </div>
  );
}

function MonthChart({ f, cur, testId }: { f: CashFigures; cur: string; testId: string }) {
  const T = useT();
  const t = T.d.cash;
  const ms = f.months.filter((m) => f.periods.includes(m.period));
  return (
    <>
      <h3 className="mb-1 text-lg font-normal">{t.byMonth}</h3>
      <ColumnChart labels={ms.map((m) => T.ms(m.period))} cur={cur} height={260} testId={testId}
        series={[{ name: t.moneyIn, values: ms.map((m) => m.in), color: C.green }, { name: t.moneyOut, values: ms.map((m) => m.out), color: C.red }, { name: t.leftLine, values: ms.map((m) => m.net), color: C.s[0] }]} />
    </>
  );
}

function AgeTable({ title, fig, cur, testId }: { title: string; fig: Fig<Unpaid>; cur: string; testId: string }) {
  const t = useT().d.cash;
  return (
    <div className="mb-6" data-testid={testId}>
      <h3 className="mb-2 text-lg font-normal">{title}</h3>
      {!fig.ok ? <p className="text-[13px] text-mute">{t.needs[fig.needs]}</p> : (
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line text-xs text-mute"><th className="py-1.5 text-start font-normal">{t.age}</th>{["0–30", "31–60", "61–90", "90+"].map((b) => <th key={b} className="py-1.5 text-end font-normal">{b}</th>)}<th className="py-1.5 text-end font-normal">{t.total}</th></tr></thead>
          <tbody><tr><td />{fig.value.buckets.map((v, i) => <td key={i} className={cn("num py-1.5 text-end", i >= 2 && v > 0 && "text-red")}>{money(v, cur)}</td>)}<td className="num py-1.5 text-end">{money(fig.value.total, cur)}</td></tr></tbody>
        </table>
      )}
    </div>
  );
}

export function CashOverview() {
  const { company, entries } = useCash();
  const T = useT();
  const t = T.d.cash;
  const { f, range } = useFigures();
  const cur = company.currency;
  if (!entries.length) return <><PageHeader title={t.nav[""]} /><Empty /></>;
  return (
    <>
      <PageHeader title={t.nav[""]} right={<RangePicker range={range} />} />
      <div className="mb-8 max-w-4xl" data-testid="cash-summary">
        <h3 className="mb-2 text-lg font-normal">{t.summary}</h3>
        <ul className="ms-5 list-disc space-y-1.5 text-[15.5px] leading-relaxed">{cashSummary(f, cur, T.lang).map((s) => <li key={s}>{s}</li>)}</ul>
      </div>
      <div className="mb-8 grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-3 xl:grid-cols-6">
        <Tile label={t.moneyIn} fig={ok(f.total.in)} show={(v) => money(v, cur)} k="in" testId="cash-in"
          sub={f.change.ok ? <><Delta value={f.change.value} /> <span className="text-mute">{t.vsBefore}</span></> : undefined} />
        <Tile label={t.moneyOut} fig={ok(f.total.out)} show={(v) => money(v, cur)} k="out" testId="cash-out" />
        <Tile label={t.left} fig={ok(f.total.net)} show={(v) => money(v, cur)} neg={(v) => v < 0} k="net" testId="cash-left" />
        <Tile label={t.kept} fig={f.total.netPct === null ? { ok: false, needs: "money_in" } : ok(f.total.netPct)} show={(v) => pct(v, 1)} neg={(v) => v < 0} k="netPct" testId="cash-kept" />
        <Tile label={t.cashToday} fig={f.cash} show={(v) => money(v, cur)} neg={(v) => v < 0} k="cash" testId="cash-today" />
        <Tile label={t.avgDay} fig={f.avgDay} show={(v) => money(v, cur)} k="avgDay" testId="cash-avg-day" />
      </div>
      <div className="grid gap-10 lg:grid-cols-2">
        <div>
          <MonthChart f={f} cur={cur} testId="cash-month-chart" />
          {f.best.ok && f.worst.ok && <p className="mt-3 text-sm" data-testid="cash-best-worst">{t.best}: <b className="font-medium">{T.ml(f.best.value.period)}</b> ({money(f.best.value.net, cur)}) · {t.worst}: <b className="font-medium">{T.ml(f.worst.value.period)}</b> ({money(f.worst.value.net, cur)})</p>}
        </div>
        <div>
          <h3 className="mb-2 text-lg font-normal">{t.inBy}</h3>
          <BarList items={f.inBy.map((x) => ({ key: x.name, label: x.name, value: x.amount }))} cur={cur} max={6} testId="cash-in-by" />
          <h3 className="mb-2 mt-6 text-lg font-normal">{t.outBy}</h3>
          <BarList items={f.outBy.map((x) => ({ key: x.name, label: x.name, value: x.amount }))} cur={cur} max={6} testId="cash-out-by" />
        </div>
      </div>
    </>
  );
}

export function CashSide({ side }: { side: "in" | "out" }) {
  const { company, entries } = useCash();
  const T = useT();
  const t = T.d.cash;
  const { f, range } = useFigures();
  const cur = company.currency;
  const title = side === "in" ? t.moneyIn : t.moneyOut;
  if (!entries.length) return <><PageHeader title={title} /><Empty /></>;
  const ms = f.months.filter((m) => f.periods.includes(m.period));
  const by = side === "in" ? f.inBy : f.outBy;
  const total = side === "in" ? f.total.in : f.total.out;
  return (
    <>
      <PageHeader title={title} right={<RangePicker range={range} />} />
      <div className="mb-8 grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-3">
        <Tile label={title} fig={ok(total)} show={(v) => money(v, cur)} k={side} testId={`side-total-${side}`} sub={side === "in" && f.change.ok ? <><Delta value={f.change.value} /> <span className="text-mute">{t.vsBefore}</span></> : undefined} />
        {side === "in" && <Tile label={t.avgDay} fig={f.avgDay} show={(v) => money(v, cur)} k="avgDay" testId="side-avg-day" />}
      </div>
      <div className="grid gap-10 lg:grid-cols-2">
        <div>
          <h3 className="mb-1 text-lg font-normal">{title}</h3>
          <ColumnChart labels={ms.map((m) => T.ms(m.period))} cur={cur} height={240} testId={`side-chart-${side}`} series={[{ name: title, values: ms.map((m) => (side === "in" ? m.in : m.out)), color: side === "in" ? C.green : C.red }]} />
          <div className="mt-8"><AgeTable title={side === "in" ? t.unpaidIn : t.unpaidOut} fig={side === "in" ? f.unpaidIn : f.unpaidOut} cur={cur} testId={`side-unpaid-${side}`} /></div>
        </div>
        <div>
          <h3 className="mb-2 text-lg font-normal">{side === "in" ? t.inBy : t.outBy}</h3>
          <BarList items={by.map((x) => ({ key: x.name, label: x.name, value: x.amount, share: total ? (x.amount / total) * 100 : 0 }))} cur={cur} max={12} testId={`side-by-${side}`} />
          {side === "in" && <>
            <h3 className="mb-2 mt-6 text-lg font-normal">{t.customers}</h3>
            {f.parties.ok ? <BarList items={f.parties.value.map((x) => ({ key: x.name, label: x.name, value: x.amount, share: total ? (x.amount / total) * 100 : 0 }))} cur={cur} max={10} testId="side-parties" />
              : <p className="text-[13px] text-mute" data-testid="side-parties-needs">{t.needs[f.parties.needs]}</p>}
          </>}
        </div>
      </div>
    </>
  );
}

export function CashAhead() {
  const { company, entries } = useCash();
  const T = useT();
  const t = T.d.cash;
  const f = useMemo(() => cashFigures(entries, { opening: company.openingCash, today: company.today, range: "all" }), [entries, company.openingCash, company.today]);
  const fc = useMemo(() => cashForecast(f.months, company.today), [f.months, company.today]);
  const cur = company.currency;
  if (!entries.length) return <><PageHeader title={t.nav.cash} /><Empty /></>;
  const bal = f.balances.slice(-12);
  return (
    <>
      <PageHeader title={t.nav.cash} />
      <div className="mb-6 grid grid-cols-2 gap-6 lg:grid-cols-3">
        <Tile label={t.cashToday} fig={f.cash} show={(v) => money(v, cur)} neg={(v) => v < 0} k="cash" testId="ahead-cash" />
      </div>
      {!f.cash.ok && !company.readOnly && <p className="mb-6 text-sm"><Link prefetch={false} href={`/cash/${company.id}/settings`} className="text-brand-d underline" data-testid="ahead-add-opening">{t.needs.opening_cash}</Link></p>}
      {f.assumedPaid > 0 && <p className="mb-6 rounded bg-band px-4 py-2 text-[13px]" data-testid="ahead-assumed">{t.assumed(f.assumedPaid)}</p>}
      <div className="grid gap-10 lg:grid-cols-2">
        <div>
          {bal.length > 0 && <>
            <h3 className="mb-1 text-lg font-normal">{t.balance}</h3>
            <LineChart labels={bal.map((b) => T.ms(b.period))} cur={cur} height={240} testId="ahead-balance" series={[{ name: t.balance, values: bal.map((b) => b.balance), color: C.s[0], fill: true }]} />
          </>}
        </div>
        <div data-testid="ahead-forecast">
          <h3 className="mb-2 text-lg font-normal">{t.next}</h3>
          {!fc.ok ? <p className="text-[13px] text-mute">{t.needs[fc.needs]}</p> : <>
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-xs text-mute"><th className="py-1.5 text-start font-normal">{t.month}</th><th className="py-1.5 text-end font-normal">{t.nextIn}</th><th className="py-1.5 text-end font-normal">{t.nextOut}</th><th className="py-1.5 text-end font-normal">{t.nextLeft}</th></tr></thead>
              <tbody>{fc.value.points.map((p) => <tr key={p.period} className="border-b border-line/60"><td className="py-1.5">{T.ml(p.period)}</td><td className="num py-1.5 text-end">{money(p.in, cur)}</td><td className="num py-1.5 text-end">{money(p.out, cur)}</td><td className={cn("num py-1.5 text-end", p.net < 0 && "text-red")}>{money(p.net, cur)}</td></tr>)}</tbody>
            </table>
            <p className="mt-3 text-[13px] text-mute" data-testid="ahead-method">{t.method[fc.value.method]}</p>
          </>}
        </div>
      </div>
    </>
  );
}

"use client";
import { Fragment, useMemo, useState, useTransition } from "react";
import { CheckCircle2, HandCoins, TriangleAlert } from "lucide-react";
import { analyze, hasBS, hasPL, money, pct, type ClassKey } from "@/lib/engine";
import { CLASS_LABEL } from "@/lib/ingest/classes";
import { paymentsAnalysis, type PaymentKind, type PaymentsAnalysis, type PaymentsFinding, type Side, type SideView } from "@/lib/engine/payments";
import { useCompany } from "@/lib/company/context";
import { usePayments } from "@/lib/company/payments-context";
import { usePeriod } from "@/lib/company/use-period";
import { useLang } from "@/lib/i18n/context";
import { useT } from "@/lib/i18n/use-t";
import { useMsg } from "@/lib/i18n/msg";
import { PageHeader } from "@/components/shell/page-header";
import { PeriodPicker } from "@/components/shell/period-picker";
import { BarList } from "@/components/charts/bar-list";
import { saveControlAccounts } from "@/app/company/[id]/settings/payments-actions";
import { cn } from "@/lib/cn";
import { UnreadInline, useUnread } from "@/components/shell/module-state";
import { Cockpit, HeroKpi, KpiTile } from "@/components/viz/kpi";
import { CardGrid, ChartCard } from "@/components/viz/chart-card";
import { AgeingStack } from "@/components/viz/ageing-stack";
import { ColumnChart } from "@/components/charts/column-chart";
import { SERIES } from "@/components/viz/palette";

/** The Payments analysis for the period chosen (payments months, else the ageing's month). */
function usePaymentsAnalysis(): { a: PaymentsAnalysis; months: string[]; hasPayments: boolean } | null {
  const c = useCompany();
  const { data, control } = usePayments();
  const lang = useLang();
  const months = useMemo(() => [...new Set([...data.payments.map((p) => p.day.slice(0, 7)), ...Object.values(data.aged).map((x) => x!.asOf.slice(0, 7))])].sort(), [data]);
  const { sel } = usePeriod(months);
  return useMemo(() => {
    if (!months.length) return null;
    const end = sel.end && months.includes(sel.end) ? sel.end : months[months.length - 1];
    const pl = c.months.filter(hasPL);
    const revenue = Object.fromEntries(pl.map((m) => [m.period, m.pl.revenue ?? 0]));
    const cost = Object.fromEntries(pl.map((m) => [m.period, (m.pl.cos_variable ?? 0) + (m.pl.cos_fixed ?? 0)]));
    const accounts = c.accounts.filter((x) => x.cls === "ar" || x.cls === "ap").map((x) => ({ code: x.code, name: x.name, cls: x.cls, amounts: x.amounts }));
    // The KPI's debtor and creditor days for the ageing's month (balance sheet basis), to show beside the ageing's own.
    const kpiAt = (asOf?: string) => {
      const p = asOf?.slice(0, 7);
      // Only a month with its own P&L and balance sheet: otherwise the KPI would use an older or empty balance sheet.
      if (!p || !c.months.some((m) => m.period === p && hasPL(m) && hasBS(m))) return null;
      try { return analyze(c.months, { type: "month", end: p }, c.settings, { asOf: c.asOf }).K; } catch { return null; }
    };
    const kr = kpiAt(data.aged.receivable?.asOf), kp = kpiAt(data.aged.payable?.asOf);
    const kpiDays = { receivable: kr?.ar_days != null ? Math.round(kr.ar_days) : null, payable: kp?.ap_days != null ? Math.round(kp.ap_days) : null };
    return { a: paymentsAnalysis(data, { type: sel.type, end }, c.settings.fyStartMonth, { accounts, control, revenue, cost, lang, cur: c.settings.currency, booksAsOf: c.asOf, vatRate: c.settings.vatRate ?? 0.14, kpiDays }), months, hasPayments: data.payments.length > 0 };
  }, [data, control, months, sel.type, sel.end, c.months, c.accounts, c.settings, c.settings.fyStartMonth, c.settings.currency, lang, c.asOf]);
}

const KIND_LABEL: Record<PaymentKind, string> = { customers: "Customers", suppliers: "Suppliers", transfer: "Between own accounts", other: "Other" };

type TT = ReturnType<typeof useT>;
/** An ageing bucket heading in the chosen language (numbers stay as exported). */
const bucketIn = (b: string, T: TT) => (T.lang === "ar" ? T.d.pay.bucket[b.trim()] ?? b : b);
/** A month in the chosen language ("2026-09" stays a figure in English). */
const monthIn = (p: string, T: TT) => (T.lang === "ar" && /^\d{4}-\d{2}$/.test(p) ? T.ml(p) : p);
/** An account class name ("Cost of Sales · Variable") in the chosen language. */
const classIn = (s: string, T: TT) => (T.lang === "ar" ? s.split(" · ").map((x) => T.d.pay.classPart[x] ?? T.tl(x)).join(" · ") : s);

/** What the cash book marks unpaid, for a business whose books came from it and that has no ageing report yet. */
function CashOwed() {
  const c = useCompany();
  const o = usePayments().cashOwed;
  const T = useT();
  const t = T.d.pay;
  if (!o || (!o.toYou.total && !o.byYou.total)) return null;
  const cur = c.settings.currency;
  const B = t.cashBuckets;
  return (
    <section className="mx-auto mt-6 max-w-xl rounded-lg border border-line p-4 text-sm" data-testid="cash-owed">
      <h2 className="font-medium">{t.fromCash(o.asOf)}</h2>
      {([[t.toYou, o.toYou, "cash-owed-to-you"], [t.byYou, o.byYou, "cash-owed-by-you"]] as const).map(([label, u, id]) => u.total ? (
        <div key={id} className="mt-2" data-testid={id}>
          <div><span className="font-medium">{label}: {money(u.total, cur)}</span></div>
          <div className="text-mute">{u.buckets.map((b, i) => `${B[i]}: ${money(b, cur)}`).join(" · ")}</div>
        </div>
      ) : null)}
      <p className="mt-2 text-[12px] text-mute">{t.cashNote}</p>
    </section>
  );
}

function NoPayments() {
  const c = useCompany();
  const unread = useUnread("payments");
  const owed = usePayments().cashOwed;
  const t = useT().d.pay;
  if (unread) return <UnreadInline module="payments" />;
  if (owed) return <CashOwed />;
  return (
    <div className="mx-auto max-w-xl py-16 text-center" data-testid="no-payments">
      <HandCoins className="mx-auto mb-4 h-12 w-12 text-brand" strokeWidth={1.4} />
      <h2 className="text-2xl font-light">{t.noneTitle}</h2>
      <p className="mt-2 text-mute">{t.noneText}</p>
      {!c.readOnly && <a href={`${c.basePath}/data/upload?step=payments`} className="mt-5 inline-block rounded-md bg-brand-d px-6 py-3 font-medium text-white" data-testid="upload-payments">{t.uploadThem}</a>}
    </div>
  );
}

/** The ageing reports are loaded but no payments list: say so, and how to get it, instead of showing zeros. */
function NoPaymentsList() {
  const c = useCompany();
  const t = useT().d.pay;
  if (useUnread("payments")) return <UnreadInline module="payments" />;
  return (
    <div className="mx-auto max-w-xl py-16 text-center" data-testid="no-payments-list">
      <HandCoins className="mx-auto mb-4 h-12 w-12 text-brand" strokeWidth={1.4} />
      <h2 className="text-2xl font-light">{t.noListTitle}</h2>
      <p className="mt-2 text-mute">{t.noListText}</p>
      {!c.readOnly && <a href={`${c.basePath}/data/upload?step=payments`} className="mt-5 inline-block rounded-md bg-brand-d px-6 py-3 font-medium text-white" data-testid="upload-payments-list">{t.uploadPayments}</a>}
    </div>
  );
}

function Tile({ label, value, sub, neg, testId }: { label: string; value: React.ReactNode; sub?: React.ReactNode; neg?: boolean; testId?: string }) {
  return <KpiTile label={label} value={value} sub={sub} accent={neg ? "bad" : "good"} testId={testId} />;
}

function Findings({ findings }: { findings: PaymentsFinding[] }) {
  if (!findings.length) return null;
  return (
    <div className="mb-6" data-testid="payments-findings">
      {findings.map((f) => (
        <div key={f.title} className={cn("mb-2 rounded-lg border border-line border-s-[3px] bg-white px-4 py-2.5 text-[13px]", f.kind === "risk" ? "border-s-red" : f.kind === "watch" ? "border-s-amber" : "border-s-green")}>
          <b className="font-semibold">{f.title}.</b> {f.text}
        </div>
      ))}
    </div>
  );
}

/** The ageing against its control account in the books: agrees, differs (by how much), or no books for that month. */
function Tieouts({ a }: { a: PaymentsAnalysis }) {
  const c = useCompany();
  const w = useT().d.pay;
  const cur = c.settings.currency;
  if (!a.tieouts.length) return null;
  return (
    <div className="mb-8 space-y-2" data-testid="payments-tieouts">
      {a.tieouts.map((x) => (
        <div key={x.side} className={cn("rounded px-4 py-2.5 text-[13px]", x.status === "ok" ? "bg-green-bg text-green-d" : x.status === "off" ? "bg-red-bg text-red" : "bg-band text-mute")} data-testid={`tieout-${x.side}`} data-status={x.status}>
          <p className="flex items-start gap-2">
            {x.status === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>
              {w.tieAgeing(x.side === "receivable" ? w.receivables : w.payables, x.asOf, money(x.ageing, cur))}
              {x.status === "no_books" ? w.noBooks : <>{w.books(money(x.books, cur), x.account)}{x.status === "ok" ? w.agree : w.diff(money(x.diff, cur))}</>}
              {x.notInAgeing.length > 0 && <span className="block text-mute">{w.notInAgeing(x.notInAgeing.map((y) => `${y.account} ${money(y.amount, cur)}`).join("; "))}</span>}
            </span>
          </p>
          <ControlChoice side={x.side} />
        </div>
      ))}
    </div>
  );
}

/** Which account(s) the ageing is kept on: suggested by iReport, or chosen here once (editors). */
function ControlChoice({ side }: { side: Side }) {
  const c = useCompany();
  const { control } = usePayments();
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const t = useT().d.pay;
  const m = useMsg();
  const own = c.accounts.filter((x) => x.cls === (side === "receivable" ? "ar" : "ap"));
  const [picked, setPicked] = useState<string[]>(control[side] ?? []);
  if (c.readOnly || c.basePath.startsWith("/demo") || !own.length) return null;
  if (!open) return <button className="ms-6 mt-1 text-[12px] underline" onClick={() => setOpen(true)} data-testid={`control-${side}`}>{control[side]?.length ? t.change : t.choose}</button>;
  return (
    <div className="ms-6 mt-2 text-ink">
      {own.map((x) => (
        <label key={x.code + x.name} className="me-4 inline-flex items-center gap-1.5 text-[12px]">
          <input type="checkbox" checked={picked.includes(x.code)} onChange={(e) => setPicked(e.target.checked ? [...picked, x.code] : picked.filter((k) => k !== x.code))} />{x.code} {x.name}
        </label>
      ))}
      <button disabled={busy} className="rounded bg-brand-d px-3 py-1 text-[12px] text-white" data-testid={`control-${side}-save`}
        onClick={() => start(async () => { const r = await saveControlAccounts(c.id, side, picked); if (!r.ok) setErr(r.error ?? t.saveFailed); else setOpen(false); })}>{t.save}</button>
      {err && <span className="ms-2 text-red">{m(err)}</span>}
    </div>
  );
}

function AgeBar({ v, cur }: { v: SideView; cur: string }) {
  const T = useT();
  const buckets = v.buckets.map((b, i) => ({ label: bucketIn(b, T), value: v.partners.reduce((s, p) => s + Math.max(p.amounts[i], 0), 0) }));
  return <AgeingStack buckets={buckets} cur={cur} testId={`age-${v.side}`} note={T.d.pay.debitNote} />;
}

export function PaymentsOverview() {
  const c = useCompany();
  const r = usePaymentsAnalysis();
  const T = useT();
  const t = T.d.pay;
  const cur = c.settings.currency;
  if (!r) return <><PageHeader title={t.title} /><NoPayments /></>;
  const { a, months } = r;
  const rec = a.receivable, pay = a.payable;
  const noList = !r.hasPayments;
  const headline = [
    rec && t.owe(money(rec.owed, cur), rec.asOf, money(rec.overdue, cur), rec.owed ? ` (${pct((rec.overdue / rec.owed) * 100, 0)})` : ""),
    pay && t.oweSup(money(pay.owed, cur)),
    a.flows.received || a.flows.paid ? t.flowsLine(T.pl(a.label), money(a.flows.received, cur), money(a.flows.paid, cur)) : null,
  ].filter(Boolean).join(" ");
  return (
    <>
      <PageHeader title={t.title} right={<PeriodPicker own={months} />} />
      <Cockpit hero={
        <HeroKpi label={t.customersOwe} testId="tile-owed" value={rec ? money(rec.owed, cur) : "–"} deltaLabel={rec ? t.netCredits(money(rec.total, cur)) : t.noAgeing}
          story={<span data-testid="payments-headline">{headline}</span>}>
          {rec && rec.owed > 0 && <AgeingStack cur={cur} buckets={rec.buckets.map((b, i) => ({ label: bucketIn(b, T), value: rec.partners.reduce((s, p) => s + Math.max(p.amounts[i], 0), 0) }))} compact />}
        </HeroKpi>
      }>
        <Tile label={t.overdue} value={rec ? money(rec.overdue, cur, true) : "–"} sub={rec?.days !== null && rec?.days !== undefined ? t.dso(rec.days) : undefined} neg={!!rec && rec.overdue > rec.notDue} testId="tile-overdue" />
        <Tile label={t.over90} value={rec ? money(rec.over90, cur, true) : "–"} neg={!!rec && rec.owed > 0 && rec.over90 / rec.owed > 0.2} testId="tile-over90" />
        <Tile label={t.owedSuppliers} value={pay ? money(pay.owed, cur, true) : "–"} sub={pay ? t.netAdvances(money(pay.total, cur)) : t.noAgeing} testId="tile-payables" />
        <Tile label={t.received} value={noList ? t.notLoaded : money(a.flows.received, cur)} sub={noList ? t.uploadCustomer : a.flows.inProcess ? t.inProcess(money(a.flows.inProcess, cur)) : T.pl(a.label)} testId="tile-received" />
        <Tile label={t.paid} value={noList ? t.notLoaded : money(a.flows.paid, cur)} sub={noList ? t.uploadVendor : t.net(money(a.flows.net, cur))} neg={!noList && a.flows.net < 0} testId="tile-paid" />
      </Cockpit>
      <Tieouts a={a} />
      <CardGrid>
        {rec && <ChartCard title={t.receivables} sub={t.byAge} testId="card-age-rec"><AgeBar v={rec} cur={cur} /></ChartCard>}
        {pay && <ChartCard title={t.payables} sub={t.byAge} testId="card-age-pay"><AgeBar v={pay} cur={cur} /></ChartCard>}
        {!noList && a.flows.byMonth.length > 1 && (
          <ChartCard title={t.byMonth} wide testId="card-pay-months"
            table={{ head: [t.month, t.received, t.paid], rows: a.flows.byMonth.map((m) => [monthIn(m.p, T), money(m.received, cur), money(m.paid, cur)]) }}>
            <ColumnChart cur={cur} height={240} labels={a.flows.byMonth.map((m) => (/^\d{4}-\d{2}$/.test(m.p) ? T.ms(m.p) : m.p))} series={[
              { name: t.received, values: a.flows.byMonth.map((m) => m.received), color: SERIES[0] },
              { name: t.paid, values: a.flows.byMonth.map((m) => m.paid), color: SERIES[1] },
            ]} />
          </ChartCard>
        )}
        {rec && <ChartCard title={t.mostOverdue} testId="card-overdue">
          <BarList items={rec.partners.filter((p) => p.overdue > 0).map((p) => ({ key: p.name, label: p.name, value: p.overdue, share: rec.overdue ? p.overdue / rec.overdue : 0 }))} cur={cur} max={8} testId="overdue-bars" />
        </ChartCard>}
        {pay && <ChartCard title={t.largestOwed} testId="card-payable">
          <BarList items={pay.partners.filter((p) => p.total > 0).sort((x, y) => y.total - x.total).map((p) => ({ key: p.name, label: p.name, value: p.total, share: pay.owed ? p.total / pay.owed : 0 }))} cur={cur} max={8} testId="payable-bars" />
        </ChartCard>}
      </CardGrid>
      <Findings findings={a.findings} />
    </>
  );
}

/** One side's ageing: every partner with its buckets, searchable; open a partner to see its documents. */
export function AgeingPage({ side }: { side: Side }) {
  const c = useCompany();
  const { data } = usePayments();
  const r = usePaymentsAnalysis();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const T = useT();
  const t = T.d.pay;
  const cur = c.settings.currency;
  const title = side === "receivable" ? t.receivables : t.payables;
  const v = r?.a[side];
  if (!v) return <><PageHeader title={title} /><NoPayments /></>;
  const rows = v.partners.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));
  const items = data.aged[side]?.items ?? [];
  return (
    <>
      <PageHeader title={title} right={<span className="text-[15px]">{t.asOf}<b>{v.asOf}</b></span>} />
      <div className="mb-6 grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
        <Tile label={side === "receivable" ? t.owedBy : t.owedSuppliers} value={money(v.owed, cur)} testId="side-owed" />
        <Tile label={t.notDue} value={money(v.notDue, cur)} />
        <Tile label={t.overdue} value={money(v.overdue, cur)} neg={v.overdue > v.notDue} />
        <Tile label={t.over90} value={money(v.over90, cur)} neg={v.owed > 0 && v.over90 / v.owed > 0.2} />
        <Tile label={side === "receivable" ? t.custCredit : t.supDebit} value={money(-v.credits, cur)} sub={t.partners(v.credit.length)} neg={v.credit.length > 0} />
        {/* Days from the ageing on the KPI's basis (net of VAT), with the balance-sheet figure beside it. */}
        <Tile label={side === "receivable" ? t.debtorDays : t.creditorDays} value={v.days != null ? `${v.days}` : "–"}
          sub={v.kpiDays != null ? t.bsDays(v.kpiDays, v.days != null && Math.abs(v.days - v.kpiDays) > 15) : t.netVat} testId="side-days" />
        {side === "payable" && <Tile label={t.dueSoon} value={v.dueSoon === null ? "–" : money(v.dueSoon, cur)} sub={v.dueSoon === null ? t.noNotDue : t.notYetDue} testId="side-due-soon" />}
      </div>
      <div className="mb-6 rounded-xl border border-line p-4 sm:p-5"><h3 className="t-card mb-3">{t.byAge}</h3><AgeBar v={v} cur={cur} /></div>
      {v.findings.length > 0 && <ul className="mb-6 list-disc ps-5 text-[13px]" data-testid="side-findings">{v.findings.map((f) => <li key={f.id}>{f.message}</li>)}</ul>}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.find} className="mb-3 w-full max-w-sm rounded border border-line px-3 py-2" data-testid="partner-search" />
      <div tabIndex={0} className="overflow-x-auto">
        <table className="w-full text-[13px]" data-testid="ageing-table">
          <thead><tr className="border-b border-line text-mute"><th className="py-2 text-start">{t.partner}</th>{v.buckets.map((b) => <th key={b} className="num">{bucketIn(b, T)}</th>)}<th className="num">{t.total}</th></tr></thead>
          <tbody>
            {rows.slice(0, 300).map((p) => (
              <Fragment key={p.name}>
                <tr className="row cursor-pointer border-b border-line/50" onClick={() => setOpen(open === p.name ? null : p.name)}>
                  <td className="py-1.5 text-start">{p.name || t.noPartner} <span className="text-mute">· {p.items}</span></td>
                  {p.amounts.map((x, i) => <td key={i} className={cn("num", x < 0 && "text-red")}>{x ? money(x, cur) : ""}</td>)}
                  <td className={cn("num font-medium", p.total < 0 && "text-red")}>{money(p.total, cur)}</td>
                </tr>
                {open === p.name && items.filter((it) => it.partner === p.name).map((it, k) => (
                  <tr key={`${p.name}-${k}`} className="bg-band text-[12px]">
                    <td className="py-1 ps-6 text-start">{it.ref}{it.memo ? <span className="text-mute"> · {it.memo.slice(0, 80)}</span> : null}{it.day ? <span className="text-mute"> · {it.day}</span> : null}</td>
                    {it.amounts.map((x, i) => <td key={i} className="num">{x ? money(x, cur) : ""}</td>)}
                    <td className="num">{money(it.total, cur)}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
        {rows.length > 300 && <p className="mt-2 text-[12px] text-mute">{t.showing(rows.length)}</p>}
      </div>
    </>
  );
}

export function PaymentsFlows() {
  const c = useCompany();
  const r = usePaymentsAnalysis();
  const T = useT();
  const t = T.d.pay;
  const cur = c.settings.currency;
  if (!r) return <><PageHeader title={t.flowsTitle} /><NoPayments /></>;
  if (!r.hasPayments) return <><PageHeader title={t.flowsTitle} /><NoPaymentsList /></>;
  const f = r.a.flows;
  return (
    <>
      <PageHeader title={t.flowsTitle} right={<PeriodPicker own={r.months} />} />
      <p className="mb-5 max-w-4xl text-[14px] text-mute" data-testid="flows-basis">
        {f.basis === "ledger"
          ? <>{t.ledgerBasis}{f.transfers ? t.transfers(money(f.transfers, cur)) : null}</>
          : <>{t.listBasis}</>}
      </p>
      <div className="mb-8 grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
        <Tile label={t.received} value={money(f.received, cur)} testId="flows-received" />
        <Tile label={t.paid} value={money(f.paid, cur)} testId="flows-paid" />
        <Tile label={t.netTile} value={money(f.net, cur)} neg={f.net < 0} />
        {f.basis === "ledger"
          ? <Tile label={t.between} value={money(f.transfers, cur)} sub={t.notInOut} />
          : <Tile label={t.stillInProcess} value={money(f.inProcess, cur)} sub={t.notCleared} />}
      </div>
      {f.byMonth.length > 1 && (
        <div className="mb-8"><ChartCard title={t.byMonth} testId="card-flows-months">
          <ColumnChart cur={cur} height={240} labels={f.byMonth.map((m) => (/^\d{4}-\d{2}$/.test(m.p) ? T.ms(m.p) : m.p))} series={[
            { name: t.received, values: f.byMonth.map((m) => m.received), color: SERIES[0] },
            { name: t.paid, values: f.byMonth.map((m) => m.paid), color: SERIES[1] },
          ]} />
        </ChartCard></div>
      )}
      {f.byKind.length > 0 && (
        <div className="mb-10">
          <h3 className="mb-2 text-lg font-semibold">{t.whatItWas}</h3>
          <table className="w-full max-w-3xl text-[13px]" data-testid="flows-kinds"><thead><tr className="text-mute"><th className="text-start">{t.kindCol}</th><th className="num">{t.in}</th><th className="num">{t.out}</th></tr></thead><tbody>
            {f.byKind.map((k) => (
              <tr key={`${k.kind}|${k.counter}`} className="row border-b border-line/50">
                <td className="py-1.5 text-start">{T.lang === "ar" ? t.kind[k.kind] : KIND_LABEL[k.kind]}{k.kind === "other" && k.counter ? `: ${classIn(CLASS_LABEL[k.counter as ClassKey] ?? k.counter, T)}` : ""} <span className="text-mute">· {k.count}</span></td>
                <td className="num">{k.received ? money(k.received, cur) : ""}</td>
                <td className="num">{k.paid ? money(k.paid, cur) : ""}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
      <div className="grid gap-10 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-lg font-semibold">{f.basis === "ledger" ? t.byAccount : t.byJournal}</h3>
          <table className="w-full text-[13px]" data-testid="flows-journals"><tbody>
            {f.byJournal.map((j) => <tr key={j.journal} className="row border-b border-line/50"><td className="py-1.5 text-start">{T.tl(j.journal)} <span className="text-mute">· {j.count}</span></td><td className={cn("num", j.amount < 0 && "text-red")}>{money(j.amount, cur)}</td></tr>)}
          </tbody></table>
          <h3 className="mb-2 mt-8 text-lg font-semibold">{t.byMonth}</h3>
          <table className="w-full text-[13px]" data-testid="flows-months"><thead><tr className="text-mute"><th className="text-start">{t.month}</th><th className="num">{t.received}</th><th className="num">{t.paid}</th></tr></thead><tbody>
            {f.byMonth.map((m) => <tr key={m.p} className="row border-b border-line/50"><td className="py-1.5 text-start">{monthIn(m.p, T)}</td><td className="num">{money(m.received, cur)}</td><td className="num">{money(m.paid, cur)}</td></tr>)}
          </tbody></table>
        </div>
        <div>
          <h3 className="mb-2 text-lg font-semibold">{t.byPartner}</h3>
          <table className="w-full text-[13px]" data-testid="flows-partners"><tbody>
            {f.byPartner.slice(0, 40).map((p) => <tr key={p.partner} className="row border-b border-line/50"><td className="py-1.5 text-start">{p.partner} <span className="text-mute">· {p.count}</span></td><td className={cn("num", p.amount < 0 && "text-red")}>{money(p.amount, cur)}</td></tr>)}
          </tbody></table>
        </div>
      </div>
    </>
  );
}

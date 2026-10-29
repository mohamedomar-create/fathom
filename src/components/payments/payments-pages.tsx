"use client";
import { Fragment, useMemo, useState, useTransition } from "react";
import { CheckCircle2, HandCoins, TriangleAlert } from "lucide-react";
import { hasPL, money, pct, type ClassKey } from "@/lib/engine";
import { CLASS_LABEL } from "@/lib/ingest/classes";
import { paymentsAnalysis, type PaymentKind, type PaymentsAnalysis, type PaymentsFinding, type Side, type SideView } from "@/lib/engine/payments";
import { useCompany } from "@/lib/company/context";
import { usePayments } from "@/lib/company/payments-context";
import { usePeriod } from "@/lib/company/use-period";
import { useLang } from "@/lib/i18n/context";
import { PageHeader } from "@/components/shell/page-header";
import { PeriodPicker } from "@/components/shell/period-picker";
import { BarList } from "@/components/charts/bar-list";
import { saveControlAccounts } from "@/app/company/[id]/settings/payments-actions";
import { cn } from "@/lib/cn";
import { UnreadInline, useUnread } from "@/components/shell/module-state";

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
    return { a: paymentsAnalysis(data, { type: sel.type, end }, c.settings.fyStartMonth, { accounts, control, revenue, cost, lang, cur: c.settings.currency, booksAsOf: c.asOf }), months, hasPayments: data.payments.length > 0 };
  }, [data, control, months, sel.type, sel.end, c.months, c.accounts, c.settings.fyStartMonth, c.settings.currency, lang, c.asOf]);
}

const KIND_LABEL: Record<PaymentKind, string> = { customers: "Customers", suppliers: "Suppliers", transfer: "Between own accounts", other: "Other" };

function NoPayments() {
  const c = useCompany();
  if (useUnread("payments")) return <UnreadInline module="payments" />;
  return (
    <div className="mx-auto max-w-xl py-16 text-center" data-testid="no-payments">
      <HandCoins className="mx-auto mb-4 h-12 w-12 text-brand" strokeWidth={1.4} />
      <h2 className="text-2xl font-light">No receivables or payments yet</h2>
      <p className="mt-2 text-mute">Upload Odoo&apos;s Aged Receivable, Aged Payable and Customer / Vendor Payments.</p>
      {!c.readOnly && <a href={`${c.basePath}/data/upload?step=payments`} className="mt-5 inline-block rounded-md bg-brand-d px-6 py-3 font-medium text-white" data-testid="upload-payments">Upload them</a>}
    </div>
  );
}

/** The ageing reports are loaded but no payments list: say so, and how to get it, instead of showing zeros. */
function NoPaymentsList() {
  const c = useCompany();
  if (useUnread("payments")) return <UnreadInline module="payments" />;
  return (
    <div className="mx-auto max-w-xl py-16 text-center" data-testid="no-payments-list">
      <HandCoins className="mx-auto mb-4 h-12 w-12 text-brand" strokeWidth={1.4} />
      <h2 className="text-2xl font-light">No payments list loaded yet</h2>
      <p className="mt-2 text-mute">Your ageing reports are loaded. Payments in and out come from a separate Odoo export: Accounting → Customers → Payments, and Vendors → Payments. In the list view, tick the top box, then “Select all N records”, then Export.</p>
      {!c.readOnly && <a href={`${c.basePath}/data/upload?step=payments`} className="mt-5 inline-block rounded-md bg-brand-d px-6 py-3 font-medium text-white" data-testid="upload-payments-list">Upload payments</a>}
    </div>
  );
}

function Tile({ label, value, sub, neg, testId }: { label: string; value: React.ReactNode; sub?: React.ReactNode; neg?: boolean; testId?: string }) {
  return (
    <div className={cn("fade-up border-t-[3px] pt-2.5", neg ? "border-red" : "border-green")} data-testid={testId}>
      <div className="label">{label}</div>
      <div className="num my-0.5 whitespace-nowrap text-[21px]">{value}</div>
      {sub && <div className="text-xs text-mute">{sub}</div>}
    </div>
  );
}

function Findings({ findings }: { findings: PaymentsFinding[] }) {
  if (!findings.length) return null;
  return (
    <div className="mb-6" data-testid="payments-findings">
      {findings.map((f) => (
        <div key={f.title} className={cn("mb-2 border-s-[3px] bg-band px-4 py-2.5 text-[13px]", f.kind === "risk" ? "border-red" : f.kind === "watch" ? "border-amber" : "border-green")}>
          <b className="font-semibold">{f.title}.</b> {f.text}
        </div>
      ))}
    </div>
  );
}

/** The ageing against its control account in the books: agrees, differs (by how much), or no books for that month. */
function Tieouts({ a }: { a: PaymentsAnalysis }) {
  const c = useCompany();
  const cur = c.settings.currency;
  if (!a.tieouts.length) return null;
  return (
    <div className="mb-8 space-y-2" data-testid="payments-tieouts">
      {a.tieouts.map((t) => (
        <div key={t.side} className={cn("rounded px-4 py-2.5 text-[13px]", t.status === "ok" ? "bg-green-bg text-green-d" : t.status === "off" ? "bg-red-bg text-red" : "bg-band text-mute")} data-testid={`tieout-${t.side}`} data-status={t.status}>
          <p className="flex items-start gap-2">
            {t.status === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>
              {t.side === "receivable" ? "Receivables" : "Payables"} at {t.asOf}: ageing {money(t.ageing, cur)}
              {t.status === "no_books" ? ", no balance in the books for that month yet: upload the accounts for it." : <>, books {money(t.books, cur)} on {t.account}{t.status === "ok" ? ": they agree." : `: a difference of ${money(t.diff, cur)}.`}</>}
              {t.notInAgeing.length > 0 && <span className="block text-mute">Not in the ageing: {t.notInAgeing.map((x) => `${x.account} ${money(x.amount, cur)}`).join("; ")}.</span>}
            </span>
          </p>
          <ControlChoice side={t.side} />
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
  const own = c.accounts.filter((x) => x.cls === (side === "receivable" ? "ar" : "ap"));
  const [picked, setPicked] = useState<string[]>(control[side] ?? []);
  if (c.readOnly || c.basePath.startsWith("/demo") || !own.length) return null;
  if (!open) return <button className="ms-6 mt-1 text-[12px] underline" onClick={() => setOpen(true)} data-testid={`control-${side}`}>{control[side]?.length ? "Change the account" : "Choose the account"}</button>;
  return (
    <div className="ms-6 mt-2 text-ink">
      {own.map((x) => (
        <label key={x.code + x.name} className="me-4 inline-flex items-center gap-1.5 text-[12px]">
          <input type="checkbox" checked={picked.includes(x.code)} onChange={(e) => setPicked(e.target.checked ? [...picked, x.code] : picked.filter((k) => k !== x.code))} />{x.code} {x.name}
        </label>
      ))}
      <button disabled={busy} className="rounded bg-brand-d px-3 py-1 text-[12px] text-white" data-testid={`control-${side}-save`}
        onClick={() => start(async () => { const r = await saveControlAccounts(c.id, side, picked); if (!r.ok) setErr(r.error ?? "Saving failed."); else setOpen(false); })}>Save</button>
      {err && <span className="ms-2 text-red">{err}</span>}
    </div>
  );
}

function AgeBar({ v, cur }: { v: SideView; cur: string }) {
  const max = Math.max(...v.buckets.map((_, i) => Math.abs(v.partners.reduce((s, p) => s + Math.max(p.amounts[i], 0), 0))), 1);
  return (
    <div className="mb-6" data-testid={`age-${v.side}`}>
      {v.buckets.map((b, i) => {
        const owed = v.partners.reduce((s, p) => s + Math.max(p.amounts[i], 0), 0);
        return (
          <div key={b} className="mb-1.5 flex items-center gap-3 text-[13px]">
            <span className="w-20 shrink-0 text-mute">{b}</span>
            <span className="h-3 rounded-sm bg-brand" style={{ width: `${Math.max((owed / max) * 60, owed ? 1 : 0)}%` }} />
            <span className="num">{money(owed, cur)}</span>
          </div>
        );
      })}
      <p className="mt-2 text-[12px] text-mute">Debit balances in each bucket; credits (advances, unmatched payments) are shown apart.</p>
    </div>
  );
}

export function PaymentsOverview() {
  const c = useCompany();
  const r = usePaymentsAnalysis();
  const cur = c.settings.currency;
  if (!r) return <><PageHeader title="Payments" /><NoPayments /></>;
  const { a, months } = r;
  const rec = a.receivable, pay = a.payable;
  const noList = !r.hasPayments;
  const headline = [
    rec && `Customers owe ${money(rec.owed, cur)} at ${rec.asOf}; ${money(rec.overdue, cur)} of it is overdue${rec.owed ? ` (${pct((rec.overdue / rec.owed) * 100, 0)})` : ""}.`,
    pay && `The company owes suppliers ${money(pay.owed, cur)}.`,
    a.flows.received || a.flows.paid ? `In ${a.label}, ${money(a.flows.received, cur)} came in and ${money(a.flows.paid, cur)} went out.` : null,
  ].filter(Boolean).join(" ");
  return (
    <>
      <PageHeader title="Payments" right={<PeriodPicker own={months} />} />
      <p className="fade-up mb-6 max-w-4xl text-[17px] leading-relaxed" data-testid="payments-headline">{headline}</p>
      <div className="mb-8 grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-3 xl:grid-cols-6">
        <Tile label="Customers owe" value={rec ? money(rec.owed, cur) : "–"} sub={rec ? `net ${money(rec.total, cur)} after credits` : "no ageing"} testId="tile-owed" />
        <Tile label="Overdue" value={rec ? money(rec.overdue, cur) : "–"} sub={rec?.days !== null && rec?.days !== undefined ? `${rec.days} days of sales outstanding` : undefined} neg={!!rec && rec.overdue > rec.notDue} testId="tile-overdue" />
        <Tile label="Over 90 days" value={rec ? money(rec.over90, cur) : "–"} neg={!!rec && rec.owed > 0 && rec.over90 / rec.owed > 0.2} testId="tile-over90" />
        <Tile label="Owed to suppliers" value={pay ? money(pay.owed, cur) : "–"} sub={pay ? `net ${money(pay.total, cur)} after advances` : "no ageing"} testId="tile-payables" />
        <Tile label="Received" value={noList ? "not loaded" : money(a.flows.received, cur)} sub={noList ? "upload Customer Payments" : a.flows.inProcess ? `${money(a.flows.inProcess, cur)} still in process` : a.label} testId="tile-received" />
        <Tile label="Paid" value={noList ? "not loaded" : money(a.flows.paid, cur)} sub={noList ? "upload Vendor Payments" : `net ${money(a.flows.net, cur)}`} neg={!noList && a.flows.net < 0} testId="tile-paid" />
      </div>
      <Tieouts a={a} />
      <div className="grid gap-10 lg:grid-cols-2">
        <div>
          <Findings findings={a.findings} />
          {rec && <><h3 className="mb-2 text-lg font-normal">Receivables by age</h3><AgeBar v={rec} cur={cur} /></>}
        </div>
        <div>
          {rec && <><h3 className="mb-2 text-lg font-normal">Most overdue customers</h3>
            <BarList items={rec.partners.filter((p) => p.overdue > 0).map((p) => ({ key: p.name, label: p.name, value: p.overdue, share: rec.overdue ? p.overdue / rec.overdue : 0 }))} cur={cur} max={8} testId="overdue-bars" /></>}
          {pay && <><h3 className="mb-2 mt-8 text-lg font-normal">Largest suppliers owed</h3>
            <BarList items={pay.partners.filter((p) => p.total > 0).sort((x, y) => y.total - x.total).map((p) => ({ key: p.name, label: p.name, value: p.total, share: pay.owed ? p.total / pay.owed : 0 }))} cur={cur} max={8} testId="payable-bars" /></>}
        </div>
      </div>
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
  const cur = c.settings.currency;
  const title = side === "receivable" ? "Receivables" : "Payables";
  const v = r?.a[side];
  if (!v) return <><PageHeader title={title} /><NoPayments /></>;
  const rows = v.partners.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));
  const items = data.aged[side]?.items ?? [];
  return (
    <>
      <PageHeader title={title} right={<span className="text-[15px]">As of <b>{v.asOf}</b></span>} />
      <div className="mb-6 grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-5">
        <Tile label={side === "receivable" ? "Owed by customers" : "Owed to suppliers"} value={money(v.owed, cur)} testId="side-owed" />
        <Tile label="Not yet due" value={money(v.notDue, cur)} />
        <Tile label="Overdue" value={money(v.overdue, cur)} neg={v.overdue > v.notDue} />
        <Tile label="Over 90 days" value={money(v.over90, cur)} neg={v.owed > 0 && v.over90 / v.owed > 0.2} />
        <Tile label={side === "receivable" ? "Customers in credit" : "Suppliers in debit"} value={money(-v.credits, cur)} sub={`${v.credit.length} partners`} neg={v.credit.length > 0} />
      </div>
      {v.findings.length > 0 && <ul className="mb-6 list-disc ps-5 text-[13px]" data-testid="side-findings">{v.findings.map((f) => <li key={f.id}>{f.message}</li>)}</ul>}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a partner" className="mb-3 w-full max-w-sm rounded border border-line px-3 py-2" data-testid="partner-search" />
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]" data-testid="ageing-table">
          <thead><tr className="border-b border-line text-mute"><th className="py-2 text-start">Partner</th>{v.buckets.map((b) => <th key={b} className="num">{b}</th>)}<th className="num">Total</th></tr></thead>
          <tbody>
            {rows.slice(0, 300).map((p) => (
              <Fragment key={p.name}>
                <tr className="row cursor-pointer border-b border-line/50" onClick={() => setOpen(open === p.name ? null : p.name)}>
                  <td className="py-1.5 text-start">{p.name || "(no partner)"} <span className="text-mute">· {p.items}</span></td>
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
        {rows.length > 300 && <p className="mt-2 text-[12px] text-mute">Showing 300 of {rows.length}: search to find the others.</p>}
      </div>
    </>
  );
}

export function PaymentsFlows() {
  const c = useCompany();
  const r = usePaymentsAnalysis();
  const cur = c.settings.currency;
  if (!r) return <><PageHeader title="Payments in and out" /><NoPayments /></>;
  if (!r.hasPayments) return <><PageHeader title="Payments in and out" /><NoPaymentsList /></>;
  const f = r.a.flows;
  return (
    <>
      <PageHeader title="Payments in and out" right={<PeriodPicker own={r.months} />} />
      <p className="mb-5 max-w-4xl text-[14px] text-mute" data-testid="flows-basis">
        {f.basis === "ledger"
          ? <>From your General Ledger: every entry on your bank and cash accounts, named by the other side of its journal entry, so it agrees with the books.{f.transfers ? <> {money(f.transfers, cur)} moved between your own accounts is not counted as money in or out.</> : null}</>
          : <>From the payments list exported from Odoo. Upload your General Ledger to see every bank and cash entry, tied to the books.</>}
      </p>
      <div className="mb-8 grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
        <Tile label="Received" value={money(f.received, cur)} testId="flows-received" />
        <Tile label="Paid" value={money(f.paid, cur)} testId="flows-paid" />
        <Tile label="Net" value={money(f.net, cur)} neg={f.net < 0} />
        {f.basis === "ledger"
          ? <Tile label="Between own accounts" value={money(f.transfers, cur)} sub="not money in or out" />
          : <Tile label="Still in process" value={money(f.inProcess, cur)} sub="cheques and notes not yet cleared" />}
      </div>
      {f.byKind.length > 0 && (
        <div className="mb-10">
          <h3 className="mb-2 text-lg font-normal">What it was</h3>
          <table className="w-full max-w-3xl text-[13px]" data-testid="flows-kinds"><thead><tr className="text-mute"><th className="text-start">Kind</th><th className="num">In</th><th className="num">Out</th></tr></thead><tbody>
            {f.byKind.map((k) => (
              <tr key={`${k.kind}|${k.counter}`} className="row border-b border-line/50">
                <td className="py-1.5 text-start">{KIND_LABEL[k.kind]}{k.kind === "other" && k.counter ? `: ${CLASS_LABEL[k.counter as ClassKey] ?? k.counter}` : ""} <span className="text-mute">· {k.count}</span></td>
                <td className="num">{k.received ? money(k.received, cur) : ""}</td>
                <td className="num">{k.paid ? money(k.paid, cur) : ""}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
      <div className="grid gap-10 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-lg font-normal">{f.basis === "ledger" ? "By bank and cash account" : "By journal"}</h3>
          <table className="w-full text-[13px]" data-testid="flows-journals"><tbody>
            {f.byJournal.map((j) => <tr key={j.journal} className="row border-b border-line/50"><td className="py-1.5 text-start">{j.journal} <span className="text-mute">· {j.count}</span></td><td className={cn("num", j.amount < 0 && "text-red")}>{money(j.amount, cur)}</td></tr>)}
          </tbody></table>
          <h3 className="mb-2 mt-8 text-lg font-normal">By month</h3>
          <table className="w-full text-[13px]" data-testid="flows-months"><thead><tr className="text-mute"><th className="text-start">Month</th><th className="num">Received</th><th className="num">Paid</th></tr></thead><tbody>
            {f.byMonth.map((m) => <tr key={m.p} className="row border-b border-line/50"><td className="py-1.5 text-start">{m.p}</td><td className="num">{money(m.received, cur)}</td><td className="num">{money(m.paid, cur)}</td></tr>)}
          </tbody></table>
        </div>
        <div>
          <h3 className="mb-2 text-lg font-normal">By partner</h3>
          <table className="w-full text-[13px]" data-testid="flows-partners"><tbody>
            {f.byPartner.slice(0, 40).map((p) => <tr key={p.partner} className="row border-b border-line/50"><td className="py-1.5 text-start">{p.partner} <span className="text-mute">· {p.count}</span></td><td className={cn("num", p.amount < 0 && "text-red")}>{money(p.amount, cur)}</td></tr>)}
          </tbody></table>
        </div>
      </div>
    </>
  );
}

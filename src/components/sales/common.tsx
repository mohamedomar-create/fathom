"use client";
import Link from "next/link";
import { useMemo } from "react";
import { ShoppingBag } from "lucide-react";
import { hasPL, money, pct, salesAnalysis, salesFromAccounts, salesMonths, type SalesFinding, type SalesRow } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { usePeriod } from "@/lib/company/use-period";
import { ownMonths } from "@/lib/company/own-months";
import { useSales } from "@/lib/company/sales-context";
import { Delta } from "@/components/ui/status";
import { PeriodPicker } from "@/components/shell/period-picker";
import { cn } from "@/lib/cn";
import { useLang } from "@/lib/i18n/context";
import { useT } from "@/lib/i18n/use-t";
import { UnreadInline, useUnread } from "@/components/shell/module-state";
import { KpiTile } from "@/components/viz/kpi";

/**
 * The sales analysis for the period in the URL, with P&L revenue for the reconciliation. Without invoice lines, the P&L's
 * revenue accounts stand in (fromAccounts): sales, growth and the trend still show; customers and products need lines.
 */
export function useSalesAnalysis() {
  const c = useCompany();
  const lines = useSales();
  const base = useMemo(() => {
    const fromAccounts = !salesMonths(lines).length;
    const data = fromAccounts ? salesFromAccounts(c.accounts) : lines;
    return { fromAccounts, data, months: salesMonths(data) };
  }, [lines, c.accounts]);
  const own = useMemo(() => ownMonths(c.months.length, base.months), [c.months.length, base.months]);
  const { sel, cmp } = usePeriod(own);
  const lang = useLang();
  return useMemo(() => {
    const { fromAccounts, data, months } = base;
    if (!months.length) return null;
    const end = sel.end && months.includes(sel.end) ? sel.end : sel.end && sel.end <= months[months.length - 1] && sel.end >= months[0] ? sel.end : months[months.length - 1];
    const revenue = Object.fromEntries(c.months.filter(hasPL).map((m) => [m.period, m.pl.revenue ?? 0]));
    return { ...salesAnalysis(data, { type: sel.type, end }, c.settings.fyStartMonth, { comparison: cmp === "ly" ? "ly" : "prior", revenue, lang, asOf: c.asOf }), fromAccounts, own };
  }, [base, own, sel.type, sel.end, cmp, c.months, c.settings.fyStartMonth, lang, c.asOf]);
}

/** The period picker: the financial months when the books are loaded, else the sales' own months (never a fixed label). */
export function SalesPicker({ s, mode }: { s: { own?: string[] } | null; mode?: "for" | "upto" }) {
  const c = useCompany();
  if (c.months.length) return <PeriodPicker mode={mode} />;
  return s?.own ? <PeriodPicker mode={mode} own={s.own} /> : null;
}

export function NoSales() {
  const c = useCompany();
  const t = useT().d.sales;
  if (useUnread("sales")) return <UnreadInline module="sales" />;
  return (
    <div className="mx-auto max-w-xl py-16 text-center" data-testid="no-sales">
      <ShoppingBag className="mx-auto mb-4 h-12 w-12 text-brand" strokeWidth={1.4} />
      <h2 className="text-2xl font-light">{t.noSales}</h2>
      <p className="mt-2 text-mute">{t.eitherFile}</p>
      <ul className="mx-auto mt-3 max-w-md space-y-2 text-start text-[13.5px]">
        <li><b className="font-semibold">{t.glTip[0]}</b>{t.glTip[1]}</li>
        <li><b className="font-semibold">{t.analysisTip[0]}</b>{t.analysisTip[1]}</li>
      </ul>
      {!c.readOnly && <Link href={`${c.basePath}/data`} className="mt-6 inline-block rounded bg-brand-d px-5 py-2.5 font-medium text-white">{t.uploadSales}</Link>}
    </div>
  );
}

/** Sales read from the P&L's revenue accounts: what invoice lines would add, and where to get them. */
export function FromAccountsNote({ page }: { page?: "customers" | "products" }) {
  const c = useCompany();
  const t = useT().d.sales;
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-brand/50 bg-brand-bg/10 px-4 py-3 text-[14px]" data-testid="sales-from-accounts">
      <span>{page === "customers" ? t.fromAccCustomers : page === "products" ? t.fromAccProducts : t.fromAcc}</span>
      {!c.readOnly && <Link href={`${c.basePath}/data/upload?step=financials`} className="rounded bg-brand-d px-3 py-1.5 text-sm text-white">{t.upload}</Link>}
    </div>
  );
}

/** A KPI tile for the module pages (sales, expenses, stock): the card look, with a green or red top edge. */
export function SalesTile({ label, value, sub, neg, testId, now, last }: { label: string; value: React.ReactNode; sub?: React.ReactNode; neg?: boolean; testId?: string; now?: (number | null)[]; last?: (number | null)[] }) {
  return <KpiTile label={label} value={value} sub={sub} accent={neg ? "bad" : "good"} testId={testId} now={now} last={last} />;
}

export function Vs({ growth, label }: { growth: number | null; label: string }) {
  const t = useT().d.sales;
  return label ? <><Delta value={growth} /> <span className="text-mute">{t.vs(t.word[label] ?? label)}</span></> : <span className="text-mute">{t.noComparison}</span>;
}
export const vs = (growth: number | null, label: string) => <Vs growth={growth} label={label} />;

export function Findings({ title, kind, findings }: { title: string; kind: SalesFinding["kind"]; findings: SalesFinding[] }) {
  const list = findings.filter((f) => f.kind === kind);
  if (!list.length) return null;
  return (
    <div className="mb-6">
      <h3 className="t-card mb-2">{title}</h3>
      {list.map((f) => (
        <div key={f.title} className={cn("mb-2 rounded-lg border border-line border-s-[3px] bg-white px-4 py-2.5 text-[13px]", kind === "risk" ? "border-s-red" : kind === "watch" ? "border-s-amber" : "border-s-green")}>
          <b className="font-semibold">{f.title}.</b> {f.text}
        </div>
      ))}
    </div>
  );
}

/** A ranked table of sales rows: share, comparison, growth and margin when cost is known. */
export function SalesTable({ rows, cur, nameLabel, compareLabel, max = 25, abc, invoices, group, testId }: {
  rows: SalesRow[]; cur: string; nameLabel: string; compareLabel: string; max?: number; abc?: boolean; invoices?: boolean; group?: string; testId?: string;
}) {
  const T = useT();
  const t = T.d.sales;
  const shown = rows.slice(0, max);
  const showMargin = rows.some((r) => r.margin !== null);
  const showQty = rows.some((r) => r.qty !== null);
  return (
    <div tabIndex={0} className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="tbl min-w-[640px]" data-testid={testId}>
        <thead>
          <tr>
            <th className="text-start">{nameLabel}</th>
            {group && <th className="text-start">{group}</th>}
            {abc && <th title={t.abcTitle}>{t.cls}</th>}
            <th>{t.salesCol}</th><th>{t.share}</th>
            {compareLabel && <th>{compareLabel}</th>}
            {compareLabel && <th>{t.change}</th>}
            {showQty && <th>{t.quantity}</th>}
            {invoices && <th>{t.invoicesCol}</th>}
            {showMargin && <th>{t.margin}</th>}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.key} className="row">
              <td className="max-w-[280px] truncate text-start" title={r.name}>{T.tl(r.name)}</td>
              {group && <td className="max-w-[180px] truncate text-start text-mute" title={r.group}>{r.group ? T.tl(r.group) : r.group}</td>}
              {abc && <td>{r.abc && <span className={cn("rounded px-1.5 text-[11px] font-semibold", r.abc === "A" ? "bg-brand-bg text-brand-d" : r.abc === "B" ? "bg-band" : "text-mute")}>{r.abc}</span>}</td>}
              <td className={cn("num", r.amount < 0 && "text-red")}>{money(r.amount, cur)}</td>
              <td className="num"><span className="inline-flex items-center justify-end gap-1.5"><span dir="ltr" className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-band sm:inline-block" aria-hidden><span className="block h-full rounded-full bg-brand" style={{ width: `${Math.max(0, Math.min(100, r.share))}%` }} /></span>{pct(r.share, 1)}</span></td>
              {compareLabel && <td className="num text-mute">{r.compare === null ? "–" : money(r.compare, cur)}</td>}
              {compareLabel && <td><Delta value={r.growth} /></td>}
              {showQty && <td className="num">{r.qty === null ? "–" : r.qty.toLocaleString("en-US", { maximumFractionDigits: 1 })}</td>}
              {invoices && <td className="num">{r.invoices ?? "–"}</td>}
              {showMargin && <td className="num">{r.margin === null ? "–" : pct(r.margin, 1)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && <p className="mt-2 text-xs text-mute">{t.topOf(max, rows.length)}</p>}
    </div>
  );
}

export function DataNotes({ notes }: { notes: string[] }) {
  if (!notes.length) return null;
  return <ul className="mt-8 space-y-1 text-xs text-mute" data-testid="sales-notes">{notes.map((n) => <li key={n}>{n}</li>)}</ul>;
}

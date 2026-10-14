"use client";
import Link from "next/link";
import { useMemo } from "react";
import { ShoppingBag } from "lucide-react";
import { hasPL, money, pct, salesAnalysis, salesFromAccounts, salesMonths, type SalesFinding, type SalesRow } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { usePeriod } from "@/lib/company/use-period";
import { useSales } from "@/lib/company/sales-context";
import { Delta } from "@/components/ui/status";
import { PeriodPicker } from "@/components/shell/period-picker";
import { cn } from "@/lib/cn";

/**
 * The sales analysis for the period in the URL, with P&L revenue for the reconciliation. Without invoice lines, the P&L's
 * revenue accounts stand in (fromAccounts): sales, growth and the trend still show; customers and products need lines.
 */
export function useSalesAnalysis() {
  const c = useCompany();
  const lines = useSales();
  const { sel, cmp } = usePeriod();
  return useMemo(() => {
    const fromAccounts = !salesMonths(lines).length;
    const data = fromAccounts ? salesFromAccounts(c.accounts) : lines;
    const months = salesMonths(data);
    if (!months.length) return null;
    const end = sel.end && months.includes(sel.end) ? sel.end : sel.end && sel.end <= months[months.length - 1] && sel.end >= months[0] ? sel.end : months[months.length - 1];
    const revenue = Object.fromEntries(c.months.filter(hasPL).map((m) => [m.period, m.pl.revenue ?? 0]));
    return { ...salesAnalysis(data, { type: sel.type, end }, c.settings.fyStartMonth, { comparison: cmp === "ly" ? "ly" : "prior", revenue }), fromAccounts };
  }, [lines, sel.type, sel.end, cmp, c.accounts, c.months, c.settings.fyStartMonth]);
}

/** The period picker, which reads the financial months; with sales only, the latest sales month is shown instead. */
export function SalesPicker({ s, mode }: { s: { window: { label: string } } | null; mode?: "for" | "upto" }) {
  const c = useCompany();
  if (c.months.length) return <PeriodPicker mode={mode} />;
  return s ? <span className="text-[15px]" data-testid="sales-period">For <b>{s.window.label}</b> <span className="text-xs text-mute">(add the General Ledger to choose other periods)</span></span> : null;
}

export function NoSales() {
  const c = useCompany();
  return (
    <div className="mx-auto max-w-xl py-16 text-center" data-testid="no-sales">
      <ShoppingBag className="mx-auto mb-4 h-12 w-12 text-brand" strokeWidth={1.4} />
      <h2 className="text-2xl font-light">No sales loaded yet</h2>
      <p className="mt-2 text-mute">Either file works, and both together are best:</p>
      <ul className="mx-auto mt-3 max-w-md space-y-2 text-left text-[13.5px]">
        <li><b className="font-semibold">Odoo General Ledger</b> (Accounting ▸ Reporting ▸ General Ledger ▸ Export XLSX): its invoice lines become sales by customer, product and month automatically.</li>
        <li><b className="font-semibold">Odoo Sales or Invoice Analysis</b> (Sales ▸ Reporting ▸ Sales, or Invoicing ▸ Reporting ▸ Invoice Analysis, list view ▸ Export): adds quantities, salespeople and margins. A pivot of products or customers by month also works.</li>
      </ul>
      {!c.readOnly && <Link href={`${c.basePath}/settings/source-data`} className="mt-6 inline-block rounded bg-brand-d px-5 py-2.5 font-medium text-white">Upload sales</Link>}
    </div>
  );
}

/** Sales read from the P&L's revenue accounts: what invoice lines would add, and where to get them. */
export function FromAccountsNote({ page }: { page?: "customers" | "products" }) {
  const c = useCompany();
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-brand/50 bg-brand-bg/10 px-4 py-3 text-[14px]" data-testid="sales-from-accounts">
      <span>{page === "customers" ? "Customers need invoice lines." : page === "products" ? "Products need invoice lines. These are your revenue accounts." : "These sales come from your P&L. To see customers and products, upload your General Ledger or sales file."}</span>
      {!c.readOnly && <Link href={`${c.basePath}/settings/source-data?step=financials`} className="rounded bg-brand-d px-3 py-1.5 text-sm text-white">Upload</Link>}
    </div>
  );
}

export function SalesTile({ label, value, sub, neg, testId }: { label: string; value: React.ReactNode; sub?: React.ReactNode; neg?: boolean; testId?: string }) {
  return (
    <div className={cn("fade-up border-t-[3px] pt-2.5", neg ? "border-red" : "border-green")} data-testid={testId}>
      <div className="label">{label}</div>
      <div className="num my-0.5 whitespace-nowrap text-[21px]">{value}</div>
      {sub && <div className="text-xs">{sub}</div>}
    </div>
  );
}

export const vs = (growth: number | null, label: string) => (label ? <><Delta value={growth} /> <span className="text-mute">vs {label}</span></> : <span className="text-mute">no comparison loaded</span>);

export function Findings({ title, kind, findings }: { title: string; kind: SalesFinding["kind"]; findings: SalesFinding[] }) {
  const list = findings.filter((f) => f.kind === kind);
  if (!list.length) return null;
  return (
    <div className="mb-6">
      <h3 className="mb-2 text-lg font-normal">{title}</h3>
      {list.map((f) => (
        <div key={f.title} className={cn("mb-2 border-l-[3px] bg-band px-4 py-2.5 text-[13px]", kind === "risk" ? "border-red" : kind === "watch" ? "border-amber" : "border-green")}>
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
  const shown = rows.slice(0, max);
  const showMargin = rows.some((r) => r.margin !== null);
  const showQty = rows.some((r) => r.qty !== null);
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="tbl min-w-[640px]" data-testid={testId}>
        <thead>
          <tr>
            <th className="text-left">{nameLabel}</th>
            {group && <th className="text-left">{group}</th>}
            {abc && <th title="A: the products making the first 80% of sales; B: the next 15%; C: the rest">Class</th>}
            <th>Sales</th><th>Share</th>
            {compareLabel && <th>{compareLabel}</th>}
            {compareLabel && <th>Change</th>}
            {showQty && <th>Quantity</th>}
            {invoices && <th>Invoices</th>}
            {showMargin && <th>Margin</th>}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.key} className="row">
              <td className="max-w-[280px] truncate text-left" title={r.name}>{r.name}</td>
              {group && <td className="max-w-[180px] truncate text-left text-mute" title={r.group}>{r.group}</td>}
              {abc && <td>{r.abc && <span className={cn("rounded px-1.5 text-[11px] font-semibold", r.abc === "A" ? "bg-brand-bg text-brand-d" : r.abc === "B" ? "bg-band" : "text-mute")}>{r.abc}</span>}</td>}
              <td className={cn("num", r.amount < 0 && "text-red")}>{money(r.amount, cur)}</td>
              <td className="num">{pct(r.share, 1)}</td>
              {compareLabel && <td className="num text-mute">{r.compare === null ? "–" : money(r.compare, cur)}</td>}
              {compareLabel && <td><Delta value={r.growth} /></td>}
              {showQty && <td className="num">{r.qty === null ? "–" : r.qty.toLocaleString("en-US", { maximumFractionDigits: 1 })}</td>}
              {invoices && <td className="num">{r.invoices ?? "–"}</td>}
              {showMargin && <td className="num">{r.margin === null ? "–" : pct(r.margin, 1)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && <p className="mt-2 text-xs text-mute">Showing the top {max} of {rows.length}.</p>}
    </div>
  );
}

export function DataNotes({ notes }: { notes: string[] }) {
  if (!notes.length) return null;
  return <ul className="mt-8 space-y-1 text-xs text-mute" data-testid="sales-notes">{notes.map((n) => <li key={n}>{n}</li>)}</ul>;
}

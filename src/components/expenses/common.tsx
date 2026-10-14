"use client";
import Link from "next/link";
import { useMemo } from "react";
import { Receipt, Upload } from "lucide-react";
import { accountsFromLines, customersOf, expenseMonths, expensesAnalysis, hasPL, isExpenseClass, money, pct, type ExpenseRow } from "@/lib/engine";
import { useSales } from "@/lib/company/sales-context";
import { useCompany } from "@/lib/company/context";
import { usePeriod } from "@/lib/company/use-period";
import { useExpenses } from "@/lib/company/expenses-context";
import { Delta } from "@/components/ui/status";
import { Sparkline } from "@/components/charts/spark";
import { PeriodPicker } from "@/components/shell/period-picker";
import { cn } from "@/lib/cn";

export { DataNotes, Findings, SalesTile as Tile } from "@/components/sales/common";

/** A change in costs: up reads red, down green. */
export const costVs = (growth: number | null, label: string) => (label ? <><Delta value={growth} good={growth === null ? undefined : growth <= 0} /> <span className="text-mute">vs {label}</span></> : <span className="text-mute">no comparison loaded</span>);

/** The expenses analysis for the period in the URL: accounts from the P&L, suppliers from the expense lines. */
export function useExpensesAnalysis() {
  const c = useCompany();
  const data = useExpenses();
  const sales = useSales();
  const { sel, cmp } = usePeriod();
  return useMemo(() => {
    const fromPL = c.accounts.some((a) => isExpenseClass(a.cls));
    const lineMonths = expenseMonths(data);
    if (!fromPL && !lineMonths.length) return null;
    const end = fromPL ? sel.end : sel.end && lineMonths.includes(sel.end) ? sel.end : lineMonths[lineMonths.length - 1];
    if (!end) return null;
    const revenue = Object.fromEntries(c.months.filter(hasPL).map((m) => [m.period, m.pl.revenue ?? 0]));
    return expensesAnalysis(fromPL ? c.accounts : accountsFromLines(data), data, { type: sel.type, end }, c.settings.fyStartMonth, { comparison: cmp === "ly" ? "ly" : "prior", revenue, customers: customersOf(sales) });
  }, [data, sales, sel.type, sel.end, cmp, c.accounts, c.months, c.settings.fyStartMonth]);
}

/** The period picker, which reads the financial months; with an expenses file only, the latest month is shown instead. */
export function ExpensesPicker({ s, mode }: { s: { window: { label: string } } | null; mode?: "for" | "upto" }) {
  const c = useCompany();
  if (c.months.length) return <PeriodPicker mode={mode} />;
  return s ? <span className="text-[15px]" data-testid="expenses-period">For <b>{s.window.label}</b> <span className="text-xs text-mute">(add the General Ledger to choose other periods)</span></span> : null;
}
export type ExpensesView = NonNullable<ReturnType<typeof useExpensesAnalysis>>;

export function NoExpenses() {
  const c = useCompany();
  return (
    <div className="mx-auto max-w-xl py-16 text-center" data-testid="no-expenses">
      <Receipt className="mx-auto mb-4 h-12 w-12 text-brand" strokeWidth={1.4} />
      <h2 className="text-2xl font-light">No expenses yet</h2>
      <p className="mt-2 text-mute">Upload your General Ledger. Your costs, and who you pay, come from it.</p>
      {!c.readOnly && <Link href={`${c.basePath}/settings/source-data?step=financials`} className="mt-6 inline-block rounded bg-brand-d px-5 py-2.5 font-medium text-white">Upload my General Ledger</Link>}
    </div>
  );
}

/** Shown where suppliers would be when no expense lines are loaded for the period. */
export function NoLines({ compact }: { compact?: boolean }) {
  const c = useCompany();
  return (
    <div className={cn("flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-brand/50 bg-brand-bg/10 px-4 py-3 text-[14px]", compact ? "" : "my-6")} data-testid="no-expense-lines">
      <span>Want to see who you pay? Upload your General Ledger, or your vendor bills.</span>
      {!c.readOnly && <Link href={`${c.basePath}/settings/source-data?step=expenses`} className="inline-flex items-center gap-1.5 rounded bg-brand-d px-3 py-1.5 text-sm text-white"><Upload className="h-3.5 w-3.5" />Upload</Link>}
    </div>
  );
}

/** A ranked table of cost rows: share, % of sales, comparison and change (a rise in cost reads red). */
export function ExpenseTable({ rows, cur, nameLabel, compareLabel, max = 25, group, kind, testId }: {
  rows: ExpenseRow[]; cur: string; nameLabel: string; compareLabel: string; max?: number; group?: string; kind?: "accounts" | "suppliers"; testId?: string;
}) {
  const shown = rows.slice(0, max);
  const ofSales = rows.some((r) => r.ofSales !== null);
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="tbl min-w-[680px]" data-testid={testId}>
        <thead>
          <tr>
            <th className="text-left">{nameLabel}</th>
            {group && <th className="text-left">{group}</th>}
            <th>Spent</th><th>Share</th>
            {ofSales && <th title="As a % of sales in the period">% of sales</th>}
            {compareLabel && <th>{compareLabel}</th>}
            {compareLabel && <th>Change</th>}
            {kind === "accounts" && <th className="text-left">Months</th>}
            {kind === "suppliers" && <th>Bills</th>}
            {kind === "suppliers" && <th>Average bill</th>}
            {kind === "suppliers" && rows.some((r) => r.stock) && <th title="Goods bought for stock: they reach costs as cost of sales when sold">For stock</th>}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.key} className="row" data-testid="expense-row">
              <td className="max-w-[300px] truncate text-left" title={r.name}>
                {r.name}
                {r.isNew && <span className="ml-2 rounded bg-brand-bg px-1.5 text-[10.5px] font-semibold text-brand-d">new</span>}
                {kind === "accounts" && r.recurring === false && r.amount > 0 && <span className="ml-2 rounded bg-band px-1.5 text-[10.5px] text-mute" title="Not in most months of the period">one-off</span>}
              </td>
              {group && <td className="max-w-[180px] truncate text-left text-mute" title={r.group}>{r.group}</td>}
              <td className={cn("num", r.amount < 0 && "text-green-d")}>{money(r.amount, cur)}</td>
              <td className="num">{pct(r.share, 1)}</td>
              {ofSales && <td className="num text-mute">{r.ofSales === null ? "–" : pct(r.ofSales, 1)}</td>}
              {compareLabel && <td className="num text-mute">{r.compare === null ? "–" : money(r.compare, cur)}</td>}
              {compareLabel && <td><Delta value={r.growth} good={r.growth === null ? undefined : r.growth <= 0} /></td>}
              {kind === "accounts" && <td className="text-left">{r.spark && r.spark.length > 1 ? <Sparkline values={r.spark} w={90} h={22} color="#7a7a72" /> : <span className="text-mute">{r.months ?? 0}</span>}</td>}
              {kind === "suppliers" && <td className="num">{r.docs || "–"}</td>}
              {kind === "suppliers" && <td className="num">{r.avg === null || r.avg === undefined ? "–" : money(r.avg, cur)}</td>}
              {kind === "suppliers" && rows.some((x) => x.stock) && <td className="num text-mute">{r.stock ? money(r.stock, cur) : "–"}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && <p className="mt-2 text-xs text-mute">Showing the top {max} of {rows.length}.</p>}
    </div>
  );
}

/** From last period's costs to this period's: what each account added (red) or saved (green). Adds up exactly. */
export function CostBridge({ s, cur }: { s: ExpensesView; cur: string }) {
  if (s.compare === null || !s.bridge.length) return null;
  const steps: { label: string; from: number; to: number; kind: "total" | "up" | "down" }[] = [{ label: `Costs, ${s.compareLabel}`, from: 0, to: s.compare, kind: "total" }];
  let run = s.compare;
  for (const b of s.bridge) { steps.push({ label: b.name, from: run, to: run + b.delta, kind: b.delta > 0 ? "up" : "down" }); run += b.delta; }
  steps.push({ label: "Costs, this period", from: 0, to: s.total, kind: "total" });
  // The steps are small against the totals: the axis starts below the smallest running total so they can be seen.
  const ends = steps.flatMap((x) => (x.kind === "total" ? [x.to] : [x.from, x.to]));
  const hi = Math.max(...ends), min = Math.min(...ends);
  const lo = Math.max(0, min - (hi - min) * 0.25);
  const X = (v: number) => ((Math.max(v, lo) - lo) / (hi - lo || 1)) * 100;
  return (
    <div className="text-[12.5px]" data-testid="cost-bridge">
      {steps.map((x, i) => {
        const a = X(Math.min(x.from, x.to)), b = X(Math.max(x.from, x.to));
        const delta = x.to - x.from;
        return (
          <div key={i} className={cn("grid grid-cols-[minmax(110px,42%)_1fr] items-center gap-3", x.kind === "total" && i > 0 && "border-t border-ink pt-1 font-semibold")}>
            <div className="truncate py-[5px]" title={x.label}>{x.label}</div>
            <div className="relative h-5">
              <div className="absolute inset-y-[3px] rounded-[2px]" style={{ left: `${a}%`, width: `max(${b - a}%, 2px)`, background: x.kind === "total" ? "#5b5b55" : x.kind === "up" ? "#D9343A" : "#2E9E6A" }} />
              <span className={cn("num absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px]", x.kind === "up" ? "text-red" : x.kind === "down" ? "text-green-d" : "")} style={b < 70 ? { left: `calc(${b}% + 6px)` } : { right: `calc(${100 - a}% + 6px)` }}>
                {x.kind === "total" ? money(x.to, cur) : `${delta > 0 ? "+" : "−"}${money(Math.abs(delta), cur)}`}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

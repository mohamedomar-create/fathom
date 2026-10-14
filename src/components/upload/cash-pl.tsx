"use client";
import type { ClassKey } from "@/lib/engine";
import { money } from "@/lib/engine";
import { CLASS_LABEL } from "@/lib/ingest/classes";
import { CASH_COST_CLASSES } from "@/lib/ingest/cashbook";

/**
 * Building Financials from cash books: a cash-basis P&L (money in as revenue, each money-out column as a cost), with
 * the class of each column confirmed by the person. Off by default when the company already has accounts.
 */
export function CashPL({ on, onToggle, columns, map, onMap, revenue, hasAccounts, currency }: {
  on: boolean;
  onToggle: (on: boolean) => void;
  columns: { name: string; cls: ClassKey; total: number }[];
  map: Record<string, ClassKey>;
  onMap: (name: string, cls: ClassKey) => void;
  revenue: number;
  hasAccounts: boolean;
  currency: string;
}) {
  const clsOf = (c: { name: string; cls: ClassKey }) => map[c.name] ?? c.cls;
  const cos = columns.filter((c) => clsOf(c).startsWith("cos_")).reduce((a, c) => a + c.total, 0);
  const opex = columns.filter((c) => !clsOf(c).startsWith("cos_")).reduce((a, c) => a + c.total, 0);
  return (
    <section className="mb-5 max-w-5xl rounded-xl border border-line" data-testid="cash-pl">
      <label className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} data-testid="cash-pl-on" />
        <span className="text-[16px] font-medium">Also build my P&amp;L from these cash books</span>
        <span className="text-[13px] text-mute">Fills the dashboard, P&amp;L, KPIs, reports and forecast (cash basis, no balance sheet).</span>
      </label>
      {hasAccounts && on && <p className="border-b border-line bg-amber/10 px-4 py-2 text-[13px]" data-testid="cash-pl-mix">You already have accounts. A cash-basis P&amp;L replaces their figures for these months: leave this off if your accounts are kept by an accountant.</p>}
      {on && (
        <div className="px-4 py-2.5 text-[13px]">
          <p className="mb-2 text-mute">What each money-out column is in your P&amp;L:</p>
          <ul className="grid gap-x-6 gap-y-1.5 md:grid-cols-2">
            {columns.map((c, i) => (
              <li key={c.name} className="flex items-center justify-between gap-3">
                <span className="truncate">{c.name} <span className="text-mute">({money(c.total, currency)})</span></span>
                <select value={clsOf(c)} onChange={(e) => onMap(c.name, e.target.value as ClassKey)} className="rounded border border-line px-1.5 py-0.5" data-testid={`cash-pl-map-${i}`} aria-label={`What ${c.name} is`}>
                  {CASH_COST_CLASSES.map((k) => <option key={k} value={k}>{CLASS_LABEL[k]}</option>)}
                </select>
              </li>
            ))}
          </ul>
          <p className="mt-2.5" data-testid="cash-pl-preview">
            Revenue {money(revenue, currency)} · cost of sales {money(cos, currency)} · gross profit {money(revenue - cos, currency)} · operating costs {money(opex, currency)} · <b>profit {money(revenue - cos - opex, currency)}</b>
          </p>
        </div>
      )}
    </section>
  );
}

"use client";
import type { ClassKey } from "@/lib/engine";
import { money } from "@/lib/engine";
import { CLASS_LABEL } from "@/lib/ingest/classes";
import { CASH_COST_CLASSES } from "@/lib/ingest/cashbook";
import { useT } from "@/lib/i18n/use-t";

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
  const T = useT(), w = T.d.wiz.cashPl, clsLabel = (k: ClassKey) => (T.lang === "en" ? CLASS_LABEL[k] : T.d.wiz.cls[k] ?? CLASS_LABEL[k]);
  const clsOf = (c: { name: string; cls: ClassKey }) => map[c.name] ?? c.cls;
  const cos = columns.filter((c) => clsOf(c).startsWith("cos_")).reduce((a, c) => a + c.total, 0);
  const opex = columns.filter((c) => !clsOf(c).startsWith("cos_")).reduce((a, c) => a + c.total, 0);
  return (
    <section className="mb-5 max-w-5xl rounded-xl border border-line" data-testid="cash-pl">
      <label className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} data-testid="cash-pl-on" />
        <span className="text-[16px] font-medium">{w.on}</span>
        <span className="text-[13px] text-mute">{w.onSub}</span>
      </label>
      {hasAccounts && on && <p className="border-b border-line bg-amber/10 px-4 py-2 text-[13px]" data-testid="cash-pl-mix">{w.mix}</p>}
      {on && (
        <div className="px-4 py-2.5 text-[13px]">
          <p className="mb-2 text-mute">{w.each}</p>
          <ul className="grid gap-x-6 gap-y-1.5 md:grid-cols-2">
            {columns.map((c, i) => (
              <li key={c.name} className="flex items-center justify-between gap-3">
                <span className="truncate">{c.name} <span className="text-mute">({money(c.total, currency)})</span></span>
                <select value={clsOf(c)} onChange={(e) => onMap(c.name, e.target.value as ClassKey)} className="rounded border border-line px-1.5 py-0.5" data-testid={`cash-pl-map-${i}`} aria-label={w.whatIs(c.name)}>
                  {CASH_COST_CLASSES.map((k) => <option key={k} value={k}>{clsLabel(k)}</option>)}
                </select>
              </li>
            ))}
          </ul>
          <p className="mt-2.5" data-testid="cash-pl-preview">
            {w.revenue} {money(revenue, currency)} · {w.cos} {money(cos, currency)} · {w.gp} {money(revenue - cos, currency)} · {w.opex} {money(opex, currency)} · <b>{w.profit} {money(revenue - cos - opex, currency)}</b>
          </p>
        </div>
      )}
    </section>
  );
}

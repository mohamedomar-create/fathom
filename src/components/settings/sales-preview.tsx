"use client";
import { AlertTriangle, ShoppingBag } from "lucide-react";
import { money } from "@/lib/engine";
import { useT } from "@/lib/i18n/use-t";
import { readSalesGrid, salesPeriods, type SalesField, type SalesLayout, type SalesLine, type SalesOverride } from "@/lib/ingest/sales";
import type { Grid } from "@/lib/ingest/extract";

export const FIELD_LABEL: Record<SalesField, string> = {
  date: "Date", period: "Month", doc: "Invoice number", customer: "Customer", product: "Product", category: "Category", salesperson: "Salesperson",
  qty: "Quantity", untaxed: "Amount before tax", total: "Amount (with tax)", cost: "Cost", margin: "Margin",
};
const FIELDS = Object.keys(FIELD_LABEL) as SalesField[];

export interface SalesRead { lines: SalesLine[]; layouts: SalesLayout[] }

/** Reads every sales sheet with the user's corrections. */
export function readSales(grids: Grid[], ov: Record<string, SalesOverride>): SalesRead {
  const lines: SalesLine[] = [], layouts: SalesLayout[] = [];
  for (const g of grids) { const r = readSalesGrid(g, ov[g.name]); if (r) { for (const l of r.lines) lines.push(l); layouts.push(r.layout); } }
  return { lines, layouts };
}

/** How a sales export was read: the columns (correctable), the months, the total and a sample, before anything is saved. */
export function SalesPreview({ read, currency, overrides, onChange }: { read: SalesRead; currency: string; overrides: Record<string, SalesOverride>; onChange: (o: Record<string, SalesOverride>) => void }) {
  const T = useT(), w = T.d.wiz.salesPv, fl = (f: SalesField) => (T.lang === "en" ? FIELD_LABEL[f] : T.d.wiz.salesField[f] ?? FIELD_LABEL[f]);
  const ps = salesPeriods(read.lines);
  const total = read.lines.reduce((s, l) => s + l.amount, 0);
  const customers = new Set(read.lines.map((l) => l.customer)).size, products = new Set(read.lines.map((l) => l.product)).size;
  return (
    <div className="space-y-5" data-testid="sales-columns">
      <div className="flex items-center gap-2 text-lg"><ShoppingBag className="h-5 w-5 text-brand-d" />{w.title}</div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Box label={w.months} value={String(ps.length)} sub={ps.length ? `${T.ml(ps[0])} – ${T.ml(ps[ps.length - 1])}` : ""} />
        <Box label={w.net} value={money(total, currency)} sub={w.netSub} testId="sales-total-detail" />
        <Box label={w.lines} value={read.lines.length.toLocaleString("en-US")} sub={w.cp(customers, products)} />
        <Box label={w.sheets} value={String(read.layouts.length)} sub={read.layouts.map((l) => (l.kind === "pivot" ? w.pivot : w.list)).join(", ")} />
      </div>
      {read.layouts.map((l) => (
        <section key={l.sheet} className="rounded-md border border-line p-3">
          <div className="mb-2 text-sm"><b className="font-semibold">{l.sheet}</b> · {w.readAs(l.kind === "pivot" ? w.pivotOf(l.rowsAre === "customer" ? "customer" : l.rowsAre === "category" ? "category" : "product") : w.invoiceLines)} · {w.nLines(l.lines.toLocaleString("en-US"))} · {money(l.total, currency)}</div>
          {l.taxIncluded && (
            <p className="mb-2 flex items-start gap-2 rounded bg-[#fff6e0] px-3 py-2 text-[12.5px] text-[#7d5600]" data-testid="tax-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{w.tax}
            </p>
          )}
          {l.qtyFlipped ? <p className="mb-2 text-[12.5px] text-mute" data-testid="qty-flipped">{w.qtyFlipped(l.qtyFlipped, l.qtyFlipped.toLocaleString("en-US"))}</p> : null}
          {l.kind === "list" && (
            <div className="flex flex-wrap gap-2 text-[12.5px]">
              {l.columns.filter((c) => c.header).map((c) => (
                <label key={c.col} className="flex items-center gap-1 rounded border border-line px-2 py-1">
                  <span className="max-w-[160px] truncate text-mute" title={c.header}>{c.header}</span>
                  <select value={c.field ?? ""} data-testid={`sales-col-${c.col}`}
                    onChange={(e) => onChange({ ...overrides, [l.sheet]: { ...(overrides[l.sheet] ?? {}), cols: { ...overrides[l.sheet]?.cols, [c.col]: (e.target.value || null) as SalesField | null } } })}
                    className="rounded border-0 bg-band px-1 py-0.5">
                    <option value="">{w.notUsed}</option>
                    {FIELDS.map((f) => <option key={f} value={f}>{fl(f)}</option>)}
                  </select>
                </label>
              ))}
            </div>
          )}
        </section>
      ))}
      <p className="text-xs text-mute">{w.note}</p>
    </div>
  );
}

function Box({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId?: string }) {
  return (
    <div className="rounded-md border-t-[3px] border-brand bg-band px-3 py-2.5" data-testid={testId}>
      <div className="label">{label}</div>
      <div className="num text-xl">{value}</div>
      {sub && <div className="text-xs text-mute">{sub}</div>}
    </div>
  );
}

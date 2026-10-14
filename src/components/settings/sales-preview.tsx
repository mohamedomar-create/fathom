"use client";
import { AlertTriangle, ShoppingBag } from "lucide-react";
import { mlabel, money } from "@/lib/engine";
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
  for (const g of grids) { const r = readSalesGrid(g, ov[g.name]); if (r) { lines.push(...r.lines); layouts.push(r.layout); } }
  return { lines, layouts };
}

/** How a sales export was read: the columns (correctable), the months, the total and a sample, before anything is saved. */
export function SalesPreview({ read, currency, overrides, onChange }: { read: SalesRead; currency: string; overrides: Record<string, SalesOverride>; onChange: (o: Record<string, SalesOverride>) => void }) {
  const ps = salesPeriods(read.lines);
  const total = read.lines.reduce((s, l) => s + l.amount, 0);
  const customers = new Set(read.lines.map((l) => l.customer)).size, products = new Set(read.lines.map((l) => l.product)).size;
  return (
    <div className="space-y-5" data-testid="sales-columns">
      <div className="flex items-center gap-2 text-lg"><ShoppingBag className="h-5 w-5 text-brand-d" />Sales file</div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Box label="Months" value={String(ps.length)} sub={ps.length ? `${mlabel(ps[0])} – ${mlabel(ps[ps.length - 1])}` : ""} />
        <Box label="Net sales" value={money(total, currency)} sub="compare with the total in Odoo" testId="sales-total-detail" />
        <Box label="Lines" value={read.lines.length.toLocaleString("en-US")} sub={`${customers} customers · ${products} products`} />
        <Box label="Sheets" value={String(read.layouts.length)} sub={read.layouts.map((l) => (l.kind === "pivot" ? "pivot" : "list")).join(", ")} />
      </div>
      {read.layouts.map((l) => (
        <section key={l.sheet} className="rounded-md border border-line p-3">
          <div className="mb-2 text-sm"><b className="font-semibold">{l.sheet}</b> · read as a {l.kind === "pivot" ? `pivot of ${l.rowsAre === "customer" ? "customers" : l.rowsAre === "category" ? "categories" : "products"} by month` : "list of invoice lines"} · {l.lines.toLocaleString("en-US")} lines · {money(l.total, currency)}</div>
          {l.taxIncluded && (
            <p className="mb-2 flex items-start gap-2 rounded bg-[#fff6e0] px-3 py-2 text-[12.5px] text-[#9a6b00]" data-testid="tax-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Only a total including tax was found, so sales will read about 14% high (VAT). Export the &quot;Untaxed Total&quot; column from Odoo if you can, or pick it below.
            </p>
          )}
          {l.kind === "list" && (
            <div className="flex flex-wrap gap-2 text-[12.5px]">
              {l.columns.filter((c) => c.header).map((c) => (
                <label key={c.col} className="flex items-center gap-1 rounded border border-line px-2 py-1">
                  <span className="max-w-[160px] truncate text-mute" title={c.header}>{c.header}</span>
                  <select value={c.field ?? ""} data-testid={`sales-col-${c.col}`}
                    onChange={(e) => onChange({ ...overrides, [l.sheet]: { ...(overrides[l.sheet] ?? {}), cols: { ...overrides[l.sheet]?.cols, [c.col]: (e.target.value || null) as SalesField | null } } })}
                    className="rounded border-0 bg-band px-1 py-0.5">
                    <option value="">not used</option>
                    {FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
                  </select>
                </label>
              ))}
            </div>
          )}
        </section>
      ))}
      <p className="text-xs text-mute">Saving replaces the sales previously uploaded from a file for these months. Sales from the General Ledger are kept for other months.</p>
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

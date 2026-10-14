"use client";
import { AlertTriangle, Receipt } from "lucide-react";
import { money } from "@/lib/engine";
import { expensePeriods, readExpenseGrid, type ExpenseField, type ExpenseLayout, type ExpenseLine, type ExpenseOverride } from "@/lib/ingest/expenses";
import type { Grid } from "@/lib/ingest/extract";

export const EXPENSE_FIELD_LABEL: Record<ExpenseField, string> = {
  date: "Date", period: "Month", doc: "Bill number", supplier: "Supplier", account: "Account", category: "Expense type", label: "Description",
  untaxed: "Amount before tax", total: "Amount (with tax)",
};
const FIELDS = Object.keys(EXPENSE_FIELD_LABEL) as ExpenseField[];

export interface ExpensesRead { lines: ExpenseLine[]; layouts: ExpenseLayout[] }

/** Reads every expenses sheet with the person's corrections. */
export function readExpenses(grids: Grid[], ov: Record<string, ExpenseOverride>): ExpensesRead {
  const lines: ExpenseLine[] = [], layouts: ExpenseLayout[] = [];
  for (const g of grids) { const r = readExpenseGrid(g, ov[g.name]); if (r) { lines.push(...r.lines); layouts.push(r.layout); } }
  return { lines, layouts };
}

/** How a purchases file was read: what each column holds (correctable), before anything is saved. */
export function ExpensesPreview({ read, currency, overrides, onChange }: { read: ExpensesRead; currency: string; overrides: Record<string, ExpenseOverride>; onChange: (o: Record<string, ExpenseOverride>) => void }) {
  const ps = expensePeriods(read.lines);
  const suppliers = new Set(read.lines.map((l) => l.supplier)).size;
  return (
    <div className="space-y-4" data-testid="expense-columns">
      <div className="flex items-center gap-2 text-lg"><Receipt className="h-5 w-5 text-brand-d" />Expenses file</div>
      <p className="text-[13px] text-mute">{read.lines.length.toLocaleString("en-US")} lines · {ps.length} months · {suppliers} suppliers.</p>
      {read.layouts.map((l) => (
        <section key={l.sheet} className="rounded-md border border-line p-3">
          <div className="mb-2 text-sm"><b className="font-semibold">{l.sheet}</b> · {l.lines.toLocaleString("en-US")} lines · {money(l.total, currency)}</div>
          {l.flipped && <p className="mb-2 text-[12.5px] text-mute" data-testid="flip-note">The amounts were negative (Odoo shows bills that way), so they were turned into costs.</p>}
          {l.taxIncluded && (
            <p className="mb-2 flex items-start gap-2 rounded bg-[#fff6e0] px-3 py-2 text-[12.5px] text-[#9a6b00]" data-testid="expense-tax-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Only a total with VAT was found, so costs will read about 14% high. Pick the amount before tax below if the file has it.
            </p>
          )}
          <div className="flex flex-wrap gap-2 text-[12.5px]">
            {l.columns.filter((c) => c.header).map((c) => (
              <label key={c.col} className="flex items-center gap-1 rounded border border-line px-2 py-1">
                <span className="max-w-[160px] truncate text-mute" title={c.header}>{c.header}</span>
                <select value={c.field ?? ""} data-testid={`expense-col-${c.col}`}
                  onChange={(e) => onChange({ ...overrides, [l.sheet]: { ...(overrides[l.sheet] ?? {}), cols: { ...overrides[l.sheet]?.cols, [c.col]: (e.target.value || null) as ExpenseField | null } } })}
                  className="rounded border-0 bg-band px-1 py-0.5">
                  <option value="">not used</option>
                  {FIELDS.map((f) => <option key={f} value={f}>{EXPENSE_FIELD_LABEL[f]}</option>)}
                </select>
              </label>
            ))}
          </div>
        </section>
      ))}
      <p className="text-xs text-mute">Saving replaces the expense lines uploaded from a file for these months. Lines from your General Ledger are kept for other months.</p>
    </div>
  );
}

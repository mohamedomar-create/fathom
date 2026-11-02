import { PL_KEYS, type ClassKey } from "@/lib/engine";
import type { AccountLine } from "@/lib/company/types";
import { mapKey } from "@/lib/ingest/subclass";
import type { SortedFinancials } from "@/lib/ingest/sorted";
import type { SalesLine } from "@/lib/ingest/sales";
import type { ExpenseLine } from "@/lib/ingest/expenses";
import { EXPENSE_COLS, MARK, SALES_COLS } from "./spec";

/** One account of a filled financials template: its class and its figures by month (natural signs, as iReport stores them). */
export interface FillRow { code: string; name: string; cls: ClassKey; values: Record<string, number> }
export interface FinancialsFill { pl?: { months: string[]; rows: FillRow[] }; bs?: { months: string[]; rows: FillRow[] } }

/** iReport's sorted reading as the rows of a financials template (computed lines such as earnings to date included, so it balances). */
export function financialsFill(f: SortedFinancials): FinancialsFill {
  const rows = (gs: SortedFinancials["pl"]) => gs.flatMap((g) => g.rows.map((r) => ({ code: r.code, name: r.name.slice(0, 300), cls: g.cls, values: r.values })));
  return {
    ...(f.plPeriods.length ? { pl: { months: f.plPeriods, rows: rows(f.pl) } } : {}),
    ...(f.bsPeriods.length ? { bs: { months: f.bsPeriods, rows: rows(f.bs) } } : {}),
  };
}

const PL = new Set<string>(PL_KEYS);
/**
 * The company's stored accounts as the rows of a financials template: every month it holds (P&L and balance sheet apart),
 * codes and classes as stored. Accounts the company has classed but holds no balances for come too, empty, so the next
 * file can be filled in without retyping them; an account the company left out ("") does not.
 */
export function storedFill(accounts: AccountLine[], classed: { key: string; cls: ClassKey | ""; name: string }[]): FinancialsFill {
  const out: Record<"pl" | "bs", { months: Set<string>; rows: FillRow[] }> = { pl: { months: new Set(), rows: [] }, bs: { months: new Set(), rows: [] } };
  const seen = new Set<string>();
  for (const a of accounts) {
    const side = PL.has(a.cls) ? out.pl : out.bs;
    const values = Object.fromEntries(Object.entries(a.amounts).filter(([, v]) => v));
    Object.keys(values).forEach((p) => side.months.add(p));
    side.rows.push({ code: a.code, name: a.name.slice(0, 300), cls: a.cls, values });
    seen.add(mapKey(a));
  }
  for (const m of classed) {
    if (!m.cls || seen.has(m.key)) continue;
    seen.add(m.key);
    const code = m.key.startsWith("#") ? m.key.slice(1) : "";
    (PL.has(m.cls) ? out.pl : out.bs).rows.push({ code, name: (code ? m.name : m.key).slice(0, 300), cls: m.cls, values: {} });
  }
  const part = (s: { months: Set<string>; rows: FillRow[] }) => (s.rows.length ? { months: [...s.months].sort(), rows: s.rows } : undefined);
  const pl = part(out.pl), bs = part(out.bs);
  return { ...(pl ? { pl } : {}), ...(bs ? { bs } : {}) };
}

const csvCell = (v: string | number | null | undefined) => {
  const t = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** Sales lines as iReport's sales template, saved as CSV (any number of lines): marker in A1, the headings on row 4. */
export function salesCsv(lines: SalesLine[], currency: string): string {
  const head = SALES_COLS.map((c) => `${c.head}${c.required ? " *" : ""}`);
  const out = [[MARK.sales], ["Sales: one row per invoice line"], [`Amounts in ${currency}, before VAT. * = required.`], head];
  for (const l of lines) out.push([l.day ? dmy(l.day) : `01/${l.period.slice(5)}/${l.period.slice(0, 4)}`, l.doc, l.customer, l.product, l.category, l.salesperson, l.qty === null ? "" : String(l.qty), String(l.amount), l.cost === null ? "" : String(l.cost)]);
  return "﻿" + out.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Expense lines as iReport's expenses template, saved as CSV: marker in A1, the headings on row 4. */
export function expensesCsv(lines: ExpenseLine[], currency: string): string {
  const head = EXPENSE_COLS.map((c) => `${c.head}${c.required ? " *" : ""}`);
  const out = [[MARK.expenses], ["Expenses: one row per bill or payment"], [`Amounts in ${currency}, before VAT. * = required.`], head];
  for (const l of lines) out.push([l.day ? dmy(l.day) : `01/${l.period.slice(5)}/${l.period.slice(0, 4)}`, l.doc, l.supplier === "No supplier" ? "" : l.supplier, l.category || l.account, l.label, String(l.amount)]);
  return "\uFEFF" + out.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

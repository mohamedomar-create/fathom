import type { ClassKey } from "@/lib/engine";
import type { SortedFinancials } from "@/lib/ingest/sorted";
import type { SalesLine } from "@/lib/ingest/sales";
import { MARK, SALES_COLS } from "./spec";

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

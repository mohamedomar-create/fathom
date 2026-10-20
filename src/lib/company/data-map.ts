// Which upload feeds which part of the app, row by row: pure, so the Readiness page works it out on the server and
// sends the rows, not the summaries behind them.
import { hasBS, hasPL, mlabel, type ExpensesData, type MonthData, type SalesData } from "@/lib/engine";

export type Sector = "financials" | "sales" | "expenses" | "banking" | "forecast";
export const SECTORS: { key: Sector; label: string }[] = [
  { key: "financials", label: "Financials" }, { key: "sales", label: "Sales" }, { key: "expenses", label: "Expenses" }, { key: "banking", label: "Banking" }, { key: "forecast", label: "Forecast" },
];
export interface Row { key: string; source: string; from?: string; months: string[]; feeds: Partial<Record<Sector, string>> }

export const span = (ps: string[]) => (!ps.length ? "–" : ps.length === 1 ? mlabel(ps[0]) : `${mlabel(ps[0])} – ${mlabel(ps[ps.length - 1])} (${ps.length})`);

/** What is loaded, row by row, and which part of it each sector uses: one upload feeds every sector it can. */
export function dataMapRows(months: MonthData[], sales: SalesData | null, expenses: ExpensesData | null): Row[] {
  const pl = months.filter(hasPL).map((m) => m.period).sort(), bs = months.filter(hasBS).map((m) => m.period).sort();
  const by = (src: Record<string, string> | undefined, s: string) => Object.entries(src ?? {}).filter(([, v]) => v === s).map(([p]) => p).sort();
  const sl = by(sales?.sources, "ledger"), sf = by(sales?.sources, "file"), el = by(expenses?.sources, "ledger"), ef = by(expenses?.sources, "file");
  const rows: Row[] = [];
  if (pl.length || bs.length) rows.push({
    key: "accounts", source: "Your accounts", from: "General Ledger, Trial Balance, P&L, PDF or Odoo", months: [...new Set([...pl, ...bs])].sort(),
    feeds: {
      financials: bs.length ? "P&L, balance sheet, cash flow" : "P&L", sales: pl.length ? "sales by revenue account" : undefined, expenses: pl.length ? "costs by account" : undefined,
      banking: bs.length ? "bank checks" : undefined, forecast: pl.length ? "starting point and trends" : undefined,
    },
  });
  if (sl.length || el.length) rows.push({ key: "ledger", source: "Lines in your ledger", from: "each invoice and bill, with its date and partner", months: [...new Set([...sl, ...el])].sort(), feeds: { sales: sl.length ? "customers and products" : undefined, expenses: el.length ? "suppliers and checks" : undefined } });
  if (sf.length) rows.push({ key: "sales-file", source: "Sales file", months: sf, feeds: { sales: "customers, products, quantities" } });
  if (ef.length) rows.push({ key: "expenses-file", source: "Expenses file", months: ef, feeds: { expenses: "suppliers and bills" } });
  return rows;
}


// Which upload feeds which part of the app, row by row: pure, so the Readiness page works it out on the server and
// sends the rows, not the summaries behind them.
import { hasBS, hasPL, mlabel, type ExpensesData, type MonthData, type SalesData } from "@/lib/engine";
import { monthLabel, type Lang } from "@/lib/i18n";
import { dat } from "@/lib/i18n/areas/dat";

export type Sector = "financials" | "sales" | "expenses" | "banking" | "forecast";
export const SECTORS: { key: Sector; label: string }[] = [
  { key: "financials", label: "Financials" }, { key: "sales", label: "Sales" }, { key: "expenses", label: "Expenses" }, { key: "banking", label: "Banking" }, { key: "forecast", label: "Forecast" },
];
export interface Row { key: string; source: string; from?: string; months: string[]; feeds: Partial<Record<Sector, string>> }

export const span = (ps: string[], lang: Lang = "en") => {
  const ml = lang === "ar" ? (p: string) => monthLabel(p, "ar") : mlabel;
  return !ps.length ? "–" : ps.length === 1 ? ml(ps[0]) : `${ml(ps[0])} – ${ml(ps[ps.length - 1])} (${ps.length})`;
};

/** What is loaded, row by row, and which part of it each sector uses: one upload feeds every sector it can. */
export function dataMapRows(months: MonthData[], sales: SalesData | null, expenses: ExpensesData | null, lang: Lang = "en"): Row[] {
  const t = lang === "ar" ? dat.ar.map : dat.en.map;
  const pl = months.filter(hasPL).map((m) => m.period).sort(), bs = months.filter(hasBS).map((m) => m.period).sort();
  const by = (src: Record<string, string> | undefined, s: string) => Object.entries(src ?? {}).filter(([, v]) => v === s).map(([p]) => p).sort();
  const sl = by(sales?.sources, "ledger"), sf = by(sales?.sources, "file"), el = by(expenses?.sources, "ledger"), ef = by(expenses?.sources, "file");
  const rows: Row[] = [];
  if (pl.length || bs.length) rows.push({
    key: "accounts", source: t.accounts, from: t.accountsFrom, months: [...new Set([...pl, ...bs])].sort(),
    feeds: {
      financials: bs.length ? t.plBsCf : t.pl, sales: pl.length ? t.salesByAccount : undefined, expenses: pl.length ? t.costsByAccount : undefined,
      banking: bs.length ? t.bankChecks : undefined, forecast: pl.length ? t.startTrends : undefined,
    },
  });
  if (sl.length || el.length) rows.push({ key: "ledger", source: t.ledger, from: t.ledgerFrom, months: [...new Set([...sl, ...el])].sort(), feeds: { sales: sl.length ? t.custProducts : undefined, expenses: el.length ? t.supChecks : undefined } });
  if (sf.length) rows.push({ key: "sales-file", source: t.salesFile, months: sf, feeds: { sales: t.custProdQty } });
  if (ef.length) rows.push({ key: "expenses-file", source: t.expFile, months: ef, feeds: { expenses: t.supBills } });
  return rows;
}


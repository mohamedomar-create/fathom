import { fyStartOf, hasPL, PL_KEYS, type MonthData } from "@/lib/engine";
import { fyMonths, seedFromLastYear, seedProducts, type BudgetLine, type BudgetProduct } from "@/lib/engine/budget";
import { accountMarkKey } from "@/lib/engine/statement-rows";
import type { SalesProductRow } from "@/lib/engine/sales";
import type { AccountLine } from "./types";

const PL = new Set<string>(PL_KEYS);

/**
 * The demo company's budget for its latest financial year: last year + 10% where last year is loaded; the demo's books
 * start mid-year, so the other months are set a little under or over what happened (made up, so there is something to
 * compare), plus products from last year's sales. Nothing is saved.
 */
export function demoBudget(accounts: AccountLine[], months: MonthData[], fyStart: number, sales: SalesProductRow[]): { fy: string; name: string; lines: BudgetLine[]; products: BudgetProduct[] } {
  const last = months.filter(hasPL).map((m) => m.period).pop() ?? "2026-01";
  const fy = fyStartOf(last, fyStart).slice(0, 4);
  const ms = fyMonths(fy, fyStart);
  const ly = seedFromLastYear(accounts, ms, 10);
  const have = new Set(ly.map((l) => `${l.key}|${l.month}`));
  const lines = [...ly];
  accounts.forEach((a, i) => {
    if (!PL.has(a.cls)) return;
    for (const m of ms) {
      const v = a.amounts[m];
      if (!v || have.has(`${accountMarkKey(a)}|${m}`)) continue;
      lines.push({ key: accountMarkKey(a), cls: a.cls, label: a.code ? `${a.code} ${a.name}` : a.name, month: m, amount: Math.round(v * (i % 3 === 0 ? 0.94 : i % 3 === 1 ? 1.05 : 1.01)) });
    }
  });
  return { fy, name: `Budget FY ${fy}`, lines, products: seedProducts(sales, ms, 10).rows };
}

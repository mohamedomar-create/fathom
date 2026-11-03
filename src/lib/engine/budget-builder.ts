// Budget builder engine (pure): base columns from history, revenue items from the company's setup, seasonal spread.
import { fyMonths } from "./budget";
import type { SalesCustomerRow, SalesProductRow } from "./sales";
import type { ExpenseAccountRow } from "./expenses";

export interface BudgetSetup {
  products: string[];
  groups: { id: string; name: string; products: string[]; customers: string[] }[];
  streams: { rental: string[] }; // product keys and "acct:<key>" revenue accounts
  expenses: { merged: { id: string; name: string; accounts: string[] }[]; excluded: string[] };
}

export interface BaseCol {
  key: string;
  label: string;
  years: { fy: string; amount: number }[];
  ytd: number;
  estimate: number;
  months: number[]; // this year's estimate by month, 12
  lastYear: number[]; // 12
  units?: number;
  price?: number;
  unitCost?: number | null;
}

type Series = Map<string, Map<string, number>>;

const r2 = (x: number) => Math.round(x * 100) / 100;

function add(series: Series, key: string, month: string, amount: number) {
  let m = series.get(key);
  if (!m) series.set(key, (m = new Map()));
  m.set(month, (m.get(month) ?? 0) + amount);
}

/**
 * Base columns for the keys in `series` (key -> month -> amount; all keys in the map are totalled, so pass a
 * one-key map for a single row). `fy` is the BUDGET year; "this year" is the financial year before it (fy-1) and
 * "last year" is fy-2. `years` holds the prior full years fy-2 .. fy-1-yearsBack that have any data, oldest first.
 * `ytd` is this year's actual up to and including the month of `asOf` (a partly elapsed month counts as actual).
 * `months` = actual up to that month, then last year's same month x (this year to date / last year same months to
 * date), or last year's month as-is when that denominator is not above zero.
 */
export function baseYears(
  series: Map<string, Map<string, number>>, fy: string, fyStart: number, asOf: string, yearsBack = 3,
): Omit<BaseCol, "key" | "label"> {
  const budgetYear = Number(fy);
  const total = new Map<string, number>();
  for (const m of series.values()) for (const [p, a] of m) total.set(p, (total.get(p) ?? 0) + a);
  const years: { fy: string; amount: number }[] = [];
  for (let i = yearsBack; i >= 1; i--) {
    const label = String(budgetYear - 1 - i);
    const ms = fyMonths(label, fyStart);
    if (!ms.some((p) => total.has(p))) continue;
    years.push({ fy: label, amount: r2(ms.reduce((t, p) => t + (total.get(p) ?? 0), 0)) });
  }
  const thisMonths = fyMonths(String(budgetYear - 1), fyStart);
  const lastYear = fyMonths(String(budgetYear - 2), fyStart).map((p) => total.get(p) ?? 0);
  const actual = thisMonths.map((p) => total.get(p) ?? 0);
  const asOfMonth = asOf.slice(0, 7);
  let ytd = 0;
  let lastToDate = 0;
  thisMonths.forEach((p, i) => {
    if (p <= asOfMonth) { ytd += actual[i]; lastToDate += lastYear[i]; }
  });
  const ratio = lastToDate > 0 ? ytd / lastToDate : 1;
  const months = thisMonths.map((p, i) => (p <= asOfMonth ? actual[i] : r2(lastYear[i] * ratio)));
  return { years, ytd: r2(ytd), estimate: r2(months.reduce((t, v) => t + v, 0)), months, lastYear };
}

export function productSeries(rows: SalesProductRow[]): Series {
  const out: Series = new Map();
  for (const r of rows) add(out, r.r, r.p, r.a);
  return out;
}

export function customerSeries(rows: SalesCustomerRow[]): Series {
  const out: Series = new Map();
  for (const r of rows) add(out, r.c, r.p, r.a);
  return out;
}

/** Expense series by key: `expgrp:<id>` for merged accounts, `exp:<t>` for the rest; excluded accounts are dropped. */
export function expenseSeries(rows: ExpenseAccountRow[], setup: BudgetSetup): Series {
  const out: Series = new Map();
  const merged = new Map<string, string>();
  for (const g of setup.expenses.merged) for (const a of g.accounts) if (!merged.has(a)) merged.set(a, g.id);
  const excluded = new Set(setup.expenses.excluded);
  for (const r of rows) {
    if (excluded.has(r.t)) continue;
    const id = merged.get(r.t);
    add(out, id ? `expgrp:${id}` : `exp:${r.t}`, r.p, r.a);
  }
  return out;
}

/** A product's revenue item: standalone wins, then the first group (setup order) holding it, else Others. */
export function itemOf(product: string, setup: BudgetSetup): string {
  if (setup.products.includes(product)) return `prod:${product}`;
  const g = setup.groups.find((x) => x.products.includes(product));
  return g ? `grp:${g.id}` : "others";
}

export function revenueItems(rows: SalesProductRow[], setup: BudgetSetup): Series {
  const out: Series = new Map();
  for (const r of rows) add(out, itemOf(r.r, setup), r.p, r.a);
  return out;
}

/**
 * Split a year amount over 12 months by `pattern`; if that is all zero use `fallback`, else equal months.
 * Months are rounded to 2 decimals and the remainder goes in the last month so the sum equals `year` to the cent.
 */
export function spread(year: number, pattern: number[], fallback?: number[]): number[] {
  const usable = (w?: number[]) => !!w && w.length === 12 && w.reduce((t, v) => t + Math.abs(v), 0) > 0;
  const w = usable(pattern) ? pattern : usable(fallback) ? fallback! : Array(12).fill(1);
  const sum = w.reduce((t, v) => t + v, 0);
  const norm = sum !== 0 ? w.map((v) => v / sum) : w.map((v) => Math.abs(v) / w.reduce((t, x) => t + Math.abs(x), 0));
  const out = norm.map((f) => r2(year * f));
  const head = out.slice(0, 11).reduce((t, v) => t + v, 0);
  out[11] = r2(r2(year) - head);
  return out;
}

// Budget builder engine (pure): base columns from history, revenue items from the company's setup, seasonal spread.
import { fyMonths, type BudgetLine } from "./budget";
import type { ClassKey } from "./index";
import { accountMarkKey } from "./statement-rows";
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
  const lastYear = fyMonths(String(budgetYear - 2), fyStart).map((p) => r2(total.get(p) ?? 0));
  const actual = thisMonths.map((p) => r2(total.get(p) ?? 0));
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
  const out = norm.map((f) => r2(year * f) || 0); // `|| 0` turns -0 into 0
  const head = out.slice(0, 11).reduce((t, v) => t + v, 0);
  out[11] = r2(r2(year) - head) || 0;
  return out;
}

// ---- rows, cost of sales, views, P&L lines, actuals ----

export type Basis = { kind: "amount"; value: number } | { kind: "pct"; value: number } | { kind: "units"; units: number; price: number };
export type Cost = { kind: "unit"; value: number } | { kind: "margin"; pct: number } | null;
export interface BudgetRow {
  view: "revenue" | "customer" | "expense"; key: string; label: string; mode: "year" | "months";
  basis: Basis | null; cost: Cost; months: number[];
  cls?: ClassKey; // expense rows: their class (default exp_fixed; a merged group takes the class of its largest member)
}

const zeros = () => Array<number>(12).fill(0);
const sumTo = (rows: number[][]) => zeros().map((_, i) => r2(rows.reduce((t, m) => t + (m[i] ?? 0), 0)));

/** A basis as 12 months, seasonal by last year's months (equal months when last year has none). */
export function rowMonths(basis: Basis, base: BaseCol): number[] {
  const year = basis.kind === "amount" ? basis.value
    : basis.kind === "pct" ? base.estimate * (1 + basis.value / 100)
    : basis.units * basis.price;
  return spread(year, base.lastYear, base.months);
}

/**
 * Cost of sales by month. `unit` (needs a units basis; otherwise ignored and the default is used): units per month =
 * the row's month / basis price, times the unit cost. `margin`: month x (1 - pct/100). Default (cost null): the base's
 * unit cost / price ratio when both are known, else 0 (Task 5 passes unitCost and price into BaseCol).
 */
export function costMonths(row: BudgetRow, base: BaseCol): number[] {
  const c = row.cost;
  if (c?.kind === "margin") return row.months.map((m) => r2(m * (1 - c.pct / 100)));
  if (c?.kind === "unit" && row.basis?.kind === "units" && row.basis.price > 0) {
    const price = row.basis.price;
    return row.months.map((m) => r2((m / price) * c.value));
  }
  if (base.unitCost != null && base.price && base.price > 0) {
    const ratio = base.unitCost / base.price;
    return row.months.map((m) => r2(m * ratio));
  }
  return zeros();
}

const customerRow = (key: string, label: string, months: number[]): BudgetRow =>
  ({ view: "customer", key, label, mode: "months", basis: null, cost: null, months });

/**
 * Customers against the revenue: each customer's share is its estimate over all customers' estimates (equal when
 * they total zero). Unedited customers get share x revenue per month; edited rows keep their months. `difference`
 * = revenue - all customer months. Rounding cents go to the last unedited customer so a fully unedited view is exact.
 */
export function customerView(revenueMonths: number[], customers: BaseCol[], edited: BudgetRow[]): { rows: BudgetRow[]; difference: number[] } {
  const total = customers.reduce((t, c) => t + c.estimate, 0);
  const share = (c: BaseCol) => (total !== 0 ? c.estimate / total : 1 / customers.length);
  const editedBy = new Map(edited.map((r) => [r.key, r]));
  const open = customers.filter((c) => !editedBy.has(c.key));
  const rows = customers.map((c) => {
    const e = editedBy.get(c.key);
    if (e) return e;
    return customerRow(c.key, c.label, revenueMonths.map((m) => r2(m * share(c))));
  });
  if (open.length) {
    const last = rows[customers.findIndex((c) => c.key === open[open.length - 1].key)];
    const exact = revenueMonths.map((m) => m * open.reduce((t, c) => t + share(c), 0));
    last.months = last.months.map((v, i) => {
      const others = rows.reduce((t, r) => (r === last || editedBy.has(r.key) ? t : t + r.months[i]), 0);
      return r2(exact[i] - others);
    });
  }
  const all = sumTo(rows.map((r) => r.months));
  return { rows, difference: revenueMonths.map((m, i) => r2(m - all[i])) };
}

/**
 * Spread each month's difference over the unedited customers by their current size (equally when all are zero).
 * Never below 0: what cannot be placed stays as the difference (the caller sums the rows again against the revenue).
 */
export function balanceCustomers(view: { rows: BudgetRow[]; difference: number[] }, editedKeys: Set<string>): BudgetRow[] {
  const open = view.rows.filter((r) => !editedKeys.has(r.key));
  const moved = new Map(open.map((r) => [r.key, r.months.slice()]));
  for (let i = 0; i < 12 && open.length; i++) {
    const size = open.reduce((t, r) => t + r.months[i], 0);
    const d = Math.max(view.difference[i], -size);
    let placed = 0;
    open.forEach((r, n) => {
      const part = n === open.length - 1 ? r2(d - placed) : r2(size > 0 ? (d * r.months[i]) / size : d / open.length);
      placed += part;
      moved.get(r.key)![i] = Math.max(0, r2(r.months[i] + part));
    });
  }
  return view.rows.map((r) => (moved.has(r.key) ? { ...r, months: moved.get(r.key)! } : r));
}

/**
 * Sales vs rental months. `members` lists, per item key, its products with this year's estimate; the rental share of
 * a row is the estimate of members in `setup.streams.rental` over all members. A standalone `prod:<p>` row with no
 * member entry is wholly rental when p is a rental product; any other row without members counts as sales.
 */
export function streamView(
  revenue: BudgetRow[], setup: BudgetSetup, members: Map<string, { product: string; estimate: number }[]>,
): { sales: number[]; rental: number[] } {
  const rentalSet = new Set(setup.streams.rental);
  const sales = zeros();
  const rental = zeros();
  for (const r of revenue) {
    const ms = members.get(r.key);
    let share = 0;
    if (ms && ms.length) {
      const all = ms.reduce((t, m) => t + m.estimate, 0);
      const rent = ms.filter((m) => rentalSet.has(m.product)).reduce((t, m) => t + m.estimate, 0);
      share = all !== 0 ? rent / all : ms.filter((m) => rentalSet.has(m.product)).length / ms.length;
    } else if (r.key.startsWith("prod:") && rentalSet.has(r.key.slice(5))) share = 1;
    for (let i = 0; i < 12; i++) {
      const rent = r2(r.months[i] * share);
      rental[i] = r2(rental[i] + rent);
      sales[i] = r2(sales[i] + r.months[i] - rent);
    }
  }
  return { sales, rental };
}

/**
 * Months per group. Product groups (`by: "products"`) take their `grp:` row plus standalone `prod:` rows of their
 * products (each standalone row only for the first matching group in setup order). Customer-only groups (no products,
 * some customers; `by: "customers"`) take their customer rows (`cust:<name>` for each name the group lists) and are not
 * part of the reconciliation. "others"
 * = revenue - the product groups, so the `by: "products"` entries always add up to the revenue.
 */
export function groupView(
  revenue: BudgetRow[], customers: BudgetRow[], setup: BudgetSetup,
): { id: string; name: string; months: number[]; by: "products" | "customers" }[] {
  const taken = new Set<string>();
  const out: { id: string; name: string; months: number[]; by: "products" | "customers" }[] = setup.groups.map((g) => {
    if (!g.products.length && g.customers.length) {
      return { id: g.id, name: g.name, by: "customers" as const, months: sumTo(customers.filter((c) => g.customers.some((name) => c.key === `cust:${name}`)).map((c) => c.months)) };
    }
    const parts: number[][] = [];
    for (const r of revenue) {
      if (r.key === `grp:${g.id}`) parts.push(r.months);
      else if (r.key.startsWith("prod:") && !taken.has(r.key) && g.products.includes(r.key.slice(5))) { parts.push(r.months); taken.add(r.key); }
    }
    return { id: g.id, name: g.name, by: "products" as const, months: sumTo(parts) };
  });
  const total = sumTo(revenue.map((r) => r.months));
  const inGroups = sumTo(out.filter((g) => g.by === "products").map((g) => g.months));
  out.push({ id: "others", name: "Others", by: "products", months: total.map((t, i) => r2(t - inGroups[i])) });
  return out;
}

/** The expense key from the row key's account text: "#code" when it starts with a code and a space or dash, else "@name". */
function expenseKey(row: BudgetRow): string {
  if (row.key.startsWith("expgrp:")) return accountMarkKey({ code: null, name: row.label });
  const t = row.key.replace(/^exp:/, "");
  const m = /^(\d+)[\s-]+(.*)$/.exec(t.trim());
  return m ? accountMarkKey({ code: m[1], name: m[2] }) : accountMarkKey({ code: null, name: t });
}

/**
 * P&L budget lines: revenue rows -> "cls:revenue", their cost of sales -> "cls:cos_variable", expense rows -> their own
 * key and class. Customer-view rows are a breakdown of the revenue and add nothing. Zero months are left out.
 */
export function budgetToLines(rows: BudgetRow[], bases: Map<string, BaseCol>, months: string[]): BudgetLine[] {
  const acc = new Map<string, BudgetLine>();
  const put = (key: string, cls: ClassKey, label: string, i: number, amount: number) => {
    const id = `${key}|${i}`;
    const cur = acc.get(id);
    if (cur) cur.amount = r2(cur.amount + amount);
    else acc.set(id, { key, cls, label: label.slice(0, 200), month: months[i], amount: r2(amount) });
  };
  for (const r of rows) {
    if (r.view === "customer") continue;
    const cost = r.view === "revenue" ? costMonths(r, bases.get(r.key) ?? { key: r.key, label: r.label, years: [], ytd: 0, estimate: 0, months: zeros(), lastYear: zeros() }) : null;
    const key = r.view === "expense" ? expenseKey(r) : "";
    for (let i = 0; i < 12; i++) {
      if (r.view === "revenue") {
        put("cls:revenue", "revenue", "Revenue (from the budget builder)", i, r.months[i]);
        put("cls:cos_variable", "cos_variable", "Cost of sales (from the budget builder)", i, cost![i]);
      } else put(key, r.cls ?? "exp_fixed", r.label, i, r.months[i]);
    }
  }
  return [...acc.values()].filter((l) => Math.abs(l.amount) >= 0.005);
}

/** Actual sales by revenue item (as the setup groups them), 12 numbers per item over `months`. */
export function actualByItem(rows: SalesProductRow[], setup: BudgetSetup, months: string[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const at = new Map(months.map((m, i) => [m, i]));
  for (const r of rows) {
    const i = at.get(r.p);
    if (i === undefined) continue;
    const key = itemOf(r.r, setup);
    const a = out.get(key) ?? out.set(key, zeros()).get(key)!;
    a[i] = r2(a[i] + r.a);
  }
  return out;
}

const ARABIC_DIGITS = /[٠-٩۰-۹]/g;

/**
 * What a typed cell means: "120000", "120,000" or Arabic-Indic digits are an amount; "+10%", "-5 %", "10%" (or "٪") a
 * change on this year's estimate. Empty or anything else is null: no change.
 */
export function parseBudgetInput(text: string): Basis | null {
  const t = text
    .replace(ARABIC_DIGITS, (ch) => String(ch.charCodeAt(0) & 0xf))
    .replace(/٫/g, ".").replace(/[,٬\s]/g, "").replace(/٪/g, "%");
  const m = /^([+-]?)(\d+(?:\.\d+)?|\.\d+)(%?)$/.exec(t);
  if (!m) return null;
  const value = Number(`${m[1]}${m[2]}`);
  if (!Number.isFinite(value) || Math.abs(value) >= 1e15) return null;
  return m[3] ? { kind: "pct", value } : { kind: "amount", value };
}

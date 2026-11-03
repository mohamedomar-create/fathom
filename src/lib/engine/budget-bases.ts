// Budget builder data (pure): the base columns of every row for a budget year, and the rows a new version starts with.
import { fyMonths } from "./budget";
import { daysIn } from "./format";
import type { ClassKey } from "./index";
import type { SalesCustomerRow, SalesProductRow } from "./sales";
import { isCostLine, type ExpenseAccountRow } from "./expenses";
import {
  baseYears, customerSeries, customerView, expenseSeries, itemOf, revenueItems, rowMonths,
  type BaseCol, type BudgetRow, type BudgetSetup, type Cost,
} from "./budget-builder";

export interface BuilderData {
  products: SalesProductRow[]; customers: SalesCustomerRow[]; expenses: ExpenseAccountRow[];
  /** Cost-of-sales accounts whose expense lines are all stock cost-of-goods postings (supplier COGS_SUPPLIER). */
  stockCogs?: string[];
  /** Cost-of-sales accounts that hold stock cost-of-goods postings and other lines: any of them means no unit cost. */
  mixedCogs?: string[];
  /** The day the latest month's figures stop on ("2026-10-10") when that month is only partly booked. */
  asOfDate?: string;
}
export interface BuilderBases {
  asOf: string | null;
  revenue: BaseCol[];
  customer: BaseCol[];
  expense: (BaseCol & { cls: ClassKey })[];
  /** Per revenue item, its products with this year's estimate (for the sales vs rental split and the Others list). */
  members: Map<string, { product: string; estimate: number }[]>;
  byKey: Map<string, BaseCol>;
  /** Stock cost-of-goods accounts left out of the expenses because the revenue rows budget that cost by unit cost. */
  excluded: string[];
  /** True when the revenue rows budget the product cost (unit cost or margin) and the stock accounts are left out. */
  byUnitCost: boolean;
}

/** The part of `month` booked by `asOfDate` (days to that date / days in the month); 1 for a complete or other month. */
export function partOf(asOfDate: string | undefined, month: string): number {
  if (!asOfDate || asOfDate.slice(0, 7) !== month) return 1;
  const day = Number(asOfDate.slice(8, 10));
  const n = daysIn(month);
  return day > 0 && day < n ? day / n : 1;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/** The latest month ("YYYY-MM") in the sales and expense figures; null when there are none. */
export function latestMonth(d: BuilderData): string | null {
  let m = "";
  for (const r of d.products) if (r.p > m) m = r.p;
  for (const r of d.customers) if (r.p > m) m = r.p;
  for (const r of d.expenses) if (r.p > m) m = r.p;
  return m || null;
}

function base(series: Map<string, Map<string, number>>, key: string, label: string, fy: string, fyStart: number, asOf: string, part: number): BaseCol {
  return { key, label, ...baseYears(new Map([[key, series.get(key) ?? new Map()]]), fy, fyStart, asOf, part) };
}

/**
 * Base columns for budget year `fy` ("this year" is fy-1): revenue items as the setup groups them (standalone products,
 * groups, Others), customers (`cust:<name>`) and expenses (`exp:<account>`, `expgrp:<id>`). Revenue items whose sales
 * this year all have quantities get `units` and `price`.
 * Cost of sales is budgeted one way only: when every revenue item with an estimate has a known cost (a unit cost: its
 * sales this year all carry quantity and cost; or a cost ratio: they all carry cost), the expenses hold stock
 * cost-of-goods accounts (`stockCogs`) and no cost-of-sales account mixes those postings with other lines
 * (`mixedCogs`), the stock accounts are left out (`excluded`) and the revenue rows budget the cost (`byUnitCost`).
 * Otherwise every cost-of-sales account stays in the expenses and no revenue row has a unit cost. Other cost-of-sales
 * accounts (freight in, direct labour) always stay. `startRows` fixes this in the version's rows; a saved version is
 * never re-decided (`versionRows`).
 */
export function builderBases(d: BuilderData, setup: BudgetSetup, fy: string, fyStart: number): BuilderBases {
  const asOf = latestMonth(d);
  const empty: BuilderBases = { asOf, revenue: [], customer: [], expense: [], members: new Map(), byKey: new Map(), excluded: [], byUnitCost: false };
  if (!asOf) return empty;
  const part = partOf(d.asOfDate, asOf);
  const thisYear = new Set(fyMonths(String(Number(fy) - 1), fyStart).filter((p) => p <= asOf));

  // Revenue items, in setup order: products, groups, Others.
  const items = revenueItems(d.products, setup);
  const groupName = new Map(setup.groups.map((g) => [`grp:${g.id}`, g.name]));
  const order = [...setup.products.map((p) => `prod:${p}`), ...setup.groups.map((g) => `grp:${g.id}`), "others"];
  const qty = new Map<string, { a: number; q: number; k: number; allQ: boolean; allK: boolean }>();
  const perProduct = new Map<string, Map<string, number>>();
  for (const r of d.products) {
    const key = itemOf(r.r, setup);
    let pm = perProduct.get(r.r);
    if (!pm) perProduct.set(r.r, (pm = new Map()));
    pm.set(r.p, (pm.get(r.p) ?? 0) + r.a);
    if (!thisYear.has(r.p)) continue;
    const x = qty.get(key) ?? { a: 0, q: 0, k: 0, allQ: true, allK: true };
    x.a += r.a;
    if (r.q === null) x.allQ = false; else x.q += r.q;
    if (r.k === null) x.allK = false; else x.k += r.k;
    qty.set(key, x);
  }
  const revenue = order.filter((k) => items.has(k)).map((k) => {
    const b = base(items, k, k.startsWith("prod:") ? k.slice(5) : k === "others" ? "Others" : groupName.get(k) ?? k, fy, fyStart, asOf, part);
    const x = qty.get(k);
    if (x && x.allQ && x.q > 0) {
      b.units = r2(x.q);
      b.price = r2(x.a / x.q);
      b.unitCost = x.allK ? r2(x.k / x.q) : null;
    }
    b.costRatio = x && x.allK && x.a > 0 ? x.k / x.a : null;
    return b;
  });
  const members = new Map<string, { product: string; estimate: number }[]>();
  for (const [p, m] of perProduct) {
    const key = itemOf(p, setup);
    const list = members.get(key) ?? members.set(key, []).get(key)!;
    list.push({ product: p, estimate: baseYears(new Map([[p, m]]), fy, fyStart, asOf, part).estimate });
  }
  for (const list of members.values()) list.sort((a, b) => b.estimate - a.estimate || (a.product < b.product ? -1 : 1));

  const bigFirst = (a: BaseCol, b: BaseCol) => b.estimate - a.estimate || (a.label < b.label ? -1 : 1);
  const cs = customerSeries(d.customers);
  const customer = [...cs.keys()].map((c) => {
    const b = base(cs, c, c, fy, fyStart, asOf, part);
    return { ...b, key: `cust:${c}` };
  }).sort(bigFirst);

  // Cost of sales: by the items' own cost (leaving out the stock cost-of-goods accounts) only when every item has one.
  const stock = new Set(d.stockCogs ?? []);
  const present = [...new Set(d.expenses.filter((r) => stock.has(r.t)).map((r) => r.t))].sort();
  const costed = revenue.filter((r) => r.estimate !== 0);
  const byUnitCost = present.length > 0 && !(d.mixedCogs ?? []).length && costed.length > 0
    && costed.every((r) => r.unitCost != null || r.costRatio != null);
  if (!byUnitCost) for (const r of revenue) { r.unitCost = null; r.costRatio = null; }
  const excluded = byUnitCost ? present : [];
  // Only costs are budgeted: a balance-sheet account (stock bought into stock interim, say) is never an expense row.
  const kept = d.expenses.filter((r) => isCostLine(r.c) && !(byUnitCost && stock.has(r.t)));

  // Expense rows and their class: an account's own class; a merged group takes its largest member's (this year).
  const clsOf = new Map<string, ClassKey>();
  const size = new Map<string, number>();
  for (const r of kept) {
    if (r.c && !clsOf.has(r.t)) clsOf.set(r.t, r.c);
    if (thisYear.has(r.p)) size.set(r.t, (size.get(r.t) ?? 0) + r.a);
  }
  const es = expenseSeries(kept, setup);
  const expense = [...es.keys()].map((k) => {
    let label = k.slice(4);
    let cls: ClassKey = "exp_fixed";
    if (k.startsWith("expgrp:")) {
      const g = setup.expenses.merged.find((m) => `expgrp:${m.id}` === k)!;
      label = g.name;
      const top = [...g.accounts].sort((a, b) => (size.get(b) ?? 0) - (size.get(a) ?? 0))[0];
      cls = clsOf.get(top) ?? "exp_fixed";
    } else cls = clsOf.get(label) ?? "exp_fixed";
    return { ...base(es, k, label, fy, fyStart, asOf, part), cls };
  }).sort(bigFirst);

  // The company's revenue pattern (last year): the spread for rows with no history of their own.
  const company = Array.from({ length: 12 }, (_, i) => r2(revenue.reduce((t, r) => t + r.lastYear[i], 0)));
  const all = [...revenue, ...customer, ...expense];
  for (const b of all) b.company = company;
  const byKey = new Map<string, BaseCol>(all.map((b) => [b.key, b]));
  return { asOf, revenue, customer, expense, members, byKey, excluded, byUnitCost };
}

/** A revenue row's cost of sales as fixed in a new version: unit cost, else margin from the cost ratio, else none. */
function costOf(b: BuilderBases, x: BaseCol): Cost {
  if (!b.byUnitCost) return null;
  if (x.unitCost != null && x.price && x.price > 0) return { kind: "unit", value: x.unitCost, price: x.price };
  if (x.costRatio != null) return { kind: "margin", pct: r2((1 - x.costRatio) * 100) };
  return null;
}

/** The rows a version built from the setup starts with: every row at this year's estimate (customers as shares of it). */
export function startRows(b: BuilderBases): BudgetRow[] {
  const at = (view: "revenue" | "expense", x: BaseCol, cls?: ClassKey): BudgetRow => ({
    view, key: x.key, label: x.label, mode: "year", basis: { kind: "pct", value: 0 },
    cost: cls ? { kind: "expense", cls } : costOf(b, x),
    months: rowMonths({ kind: "pct", value: 0 }, x), ...(cls ? { cls } : {}),
  });
  const revenue = b.revenue.map((x) => at("revenue", x));
  const total = Array.from({ length: 12 }, (_, i) => r2(revenue.reduce((t, r) => t + r.months[i], 0)));
  const customers = b.customer.length ? customerView(total, b.customer, []).rows : [];
  return [...revenue, ...customers, ...b.expense.map((x) => at("expense", x, x.cls))];
}

type View = "revenue" | "customer" | "expense";

/**
 * The rows a version shows: its saved rows when it has any (they are the truth: no row is added or dropped, and each
 * keeps the cost of sales it was built with), in the base order (setup order, then the biggest first), others after;
 * a version with no saved rows starts from the setup (`startRows`). Expense rows get their class (stored, else the
 * base's, else exp_fixed).
 */
export function versionRows(saved: BudgetRow[], b: BuilderBases): Record<View, BudgetRow[]> {
  const src = saved.length ? saved : startRows(b);
  const cls = new Map(b.expense.map((e) => [e.key, e.cls]));
  const order = new Map([...b.revenue, ...b.customer, ...b.expense].map((x, i) => [x.key, i]));
  const at = (k: string) => order.get(k) ?? order.size;
  const pick = (v: View) => src.filter((r) => r.view === v).sort((x, y) => at(x.key) - at(y.key));
  return {
    revenue: pick("revenue"), customer: pick("customer"),
    expense: pick("expense").map((r) => {
      const c = r.cls ?? (r.cost?.kind === "expense" ? r.cost.cls : undefined) ?? cls.get(r.key) ?? "exp_fixed";
      return { ...r, cls: c, cost: { kind: "expense", cls: c } };
    }),
  };
}

// Budget builder data (pure): the base columns of every row for a budget year, and the rows a new version starts with.
import { fyMonths } from "./budget";
import type { ClassKey } from "./index";
import type { SalesCustomerRow, SalesProductRow } from "./sales";
import type { ExpenseAccountRow } from "./expenses";
import {
  baseYears, customerSeries, customerView, expenseSeries, itemOf, revenueItems, rowMonths,
  type BaseCol, type BudgetRow, type BudgetSetup,
} from "./budget-builder";

export interface BuilderData {
  products: SalesProductRow[]; customers: SalesCustomerRow[]; expenses: ExpenseAccountRow[];
  /** Cost-of-sales accounts whose expense lines are all stock cost-of-goods postings (supplier COGS_SUPPLIER). */
  stockCogs?: string[];
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

function base(series: Map<string, Map<string, number>>, key: string, label: string, fy: string, fyStart: number, asOf: string): BaseCol {
  return { key, label, ...baseYears(new Map([[key, series.get(key) ?? new Map()]]), fy, fyStart, asOf) };
}

/**
 * Base columns for budget year `fy` ("this year" is fy-1): revenue items as the setup groups them (standalone products,
 * groups, Others), customers (`cust:<name>`) and expenses (`exp:<account>`, `expgrp:<id>`). Revenue items whose sales
 * this year all have quantities get `units` and `price`.
 * Cost of sales is budgeted one way only: when every revenue item with an estimate has a unit cost (its sales this year
 * all carry quantity and cost) and the expenses hold stock cost-of-goods accounts (`stockCogs`), those accounts are left
 * out (`excluded`) and the revenue rows budget the cost by unit cost. Otherwise every cost-of-sales account stays in the
 * expenses and no revenue row has a unit cost. Other cost-of-sales accounts (freight in, direct labour) always stay.
 */
export function builderBases(d: BuilderData, setup: BudgetSetup, fy: string, fyStart: number): BuilderBases {
  const asOf = latestMonth(d);
  const empty: BuilderBases = { asOf, revenue: [], customer: [], expense: [], members: new Map(), byKey: new Map(), excluded: [] };
  if (!asOf) return empty;
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
    const b = base(items, k, k.startsWith("prod:") ? k.slice(5) : k === "others" ? "Others" : groupName.get(k) ?? k, fy, fyStart, asOf);
    const x = qty.get(k);
    if (x && x.allQ && x.q > 0) {
      b.units = r2(x.q);
      b.price = r2(x.a / x.q);
      b.unitCost = x.allK ? r2(x.k / x.q) : null;
    }
    return b;
  });
  const members = new Map<string, { product: string; estimate: number }[]>();
  for (const [p, m] of perProduct) {
    const key = itemOf(p, setup);
    const list = members.get(key) ?? members.set(key, []).get(key)!;
    list.push({ product: p, estimate: baseYears(new Map([[p, m]]), fy, fyStart, asOf).estimate });
  }
  for (const list of members.values()) list.sort((a, b) => b.estimate - a.estimate || (a.product < b.product ? -1 : 1));

  const bigFirst = (a: BaseCol, b: BaseCol) => b.estimate - a.estimate || (a.label < b.label ? -1 : 1);
  const cs = customerSeries(d.customers);
  const customer = [...cs.keys()].map((c) => {
    const b = base(cs, c, c, fy, fyStart, asOf);
    return { ...b, key: `cust:${c}` };
  }).sort(bigFirst);

  // Cost of sales: by unit cost (leaving out the stock cost-of-goods accounts) only when every item has one.
  const stock = new Set(d.stockCogs ?? []);
  const present = [...new Set(d.expenses.filter((r) => stock.has(r.t)).map((r) => r.t))].sort();
  const costed = revenue.filter((r) => r.estimate !== 0);
  const byUnitCost = present.length > 0 && costed.length > 0 && costed.every((r) => r.unitCost != null);
  if (!byUnitCost) for (const r of revenue) r.unitCost = null;
  const excluded = byUnitCost ? present : [];
  const kept = byUnitCost ? d.expenses.filter((r) => !stock.has(r.t)) : d.expenses;

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
    return { ...base(es, k, label, fy, fyStart, asOf), cls };
  }).sort(bigFirst);

  const byKey = new Map<string, BaseCol>([...revenue, ...customer, ...expense].map((b) => [b.key, b]));
  return { asOf, revenue, customer, expense, members, byKey, excluded };
}

/** The rows a version built from the setup starts with: every row at this year's estimate (customers as shares of it). */
export function startRows(b: BuilderBases): BudgetRow[] {
  const at = (view: "revenue" | "expense", x: BaseCol, cls?: ClassKey): BudgetRow => ({
    view, key: x.key, label: x.label, mode: "year", basis: { kind: "pct", value: 0 }, cost: null,
    months: rowMonths({ kind: "pct", value: 0 }, x), ...(cls ? { cls } : {}),
  });
  const revenue = b.revenue.map((x) => at("revenue", x));
  const total = Array.from({ length: 12 }, (_, i) => r2(revenue.reduce((t, r) => t + r.months[i], 0)));
  const customers = b.customer.length ? customerView(total, b.customer, []).rows : [];
  return [...revenue, ...customers, ...b.expense.map((x) => at("expense", x, x.cls))];
}

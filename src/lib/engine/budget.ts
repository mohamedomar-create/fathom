import { addMonths, bsCalc, PL_KEYS, plCalc, type ClassKey, type PLCalc, type PLInput } from "@/lib/engine";
import { buildMonths } from "@/lib/company/build";
import type { AccountLine } from "@/lib/company/types";
import { accountMarkKey } from "./statement-rows";
import { compareWeight, fyStartOf, windowFor, type PeriodSel } from "./period";
import type { SalesProductRow } from "./sales";

/**
 * Budgets. A budget is kept by account (or whole class) and month, in the sign the statements show (income and costs
 * both positive), plus optional product rows (units × price, and the budget unit cost). Product rows ADD to the budget:
 * Σ units × price to revenue and Σ units × unit cost to cost of sales (variable); account lines are never dropped. A
 * budget seeded from last year with products budgets what was sold by unit as products and the rest of revenue and cost
 * of sales as one line per class, so nothing is counted twice. Everything here is pure.
 */

export interface BudgetLine { key: string; cls: ClassKey; label: string | null; month: string; amount: number }
export interface BudgetProduct { product: string; category: string | null; month: string; units: number; price: number; unit_cost: number | null }

const PL_SET = new Set<string>(PL_KEYS);
const INCOME = new Set<string>(["revenue", "other_income", "interest_income"]);
const r2 = (x: number) => Math.round(x * 100) / 100;

/** The 12 months of financial year fy (the calendar year it starts in), from the company's FY start month. */
export function fyMonths(fy: string, fyStart: number): string[] {
  const first = `${fy}-${String(fyStart).padStart(2, "0")}`;
  return Array.from({ length: 12 }, (_, i) => addMonths(first, i));
}

/** Budget lines and products as accounts the statements can read (one account per budget key, plus the product totals). */
export function budgetAccounts(lines: BudgetLine[], products: BudgetProduct[]): { accounts: AccountLine[]; notes: string[] } {
  const acc = new Map<string, AccountLine>();
  const put = (key: string, cls: ClassKey, label: string, month: string, amount: number) => {
    const a = acc.get(key) ?? { id: key, code: key.startsWith("#") ? key.slice(1) : "", name: label, cls, amounts: {} };
    a.amounts[month] = r2((a.amounts[month] ?? 0) + amount);
    acc.set(key, a);
  };
  for (const l of lines) put(l.key, l.cls, l.label ?? l.key, l.month, l.amount);
  const noCost = new Set<string>();
  for (const p of products) {
    put("prod:revenue", "revenue", "Sales (products)", p.month, p.units * p.price);
    if (p.unit_cost === null) noCost.add(p.product);
    else put("prod:cogs", "cos_variable", "Cost of sales (products)", p.month, p.units * p.unit_cost);
  }
  const notes = noCost.size ? [`No unit cost, so no cost of sales budgeted for: ${[...noCost].slice(0, 10).join(", ")}${noCost.size > 10 ? "…" : ""}`] : [];
  return { accounts: [...acc.values()], notes };
}

/**
 * The budget for the selected window, worked out by the same statements as the actual figures. When the books stop
 * part-way through the window's last month (partDay), that month's budget counts the same share of its days.
 */
export function budgetComparison(accounts: AccountLine[], sel: PeriodSel, fyStart: number, label: string, partDay?: number) {
  const w = windowFor(sel, fyStart);
  const share = compareWeight(partDay, sel.end);
  const byPeriod = new Map(buildMonths(accounts).map((m) => [m.period, m.pl]));
  const pl: PLInput = {};
  for (const p of w.periods) {
    const m = byPeriod.get(p);
    if (!m) continue;
    const f = p === sel.end ? share : 1;
    for (const [k, v] of Object.entries(m)) pl[k as keyof PLInput] = (pl[k as keyof PLInput] ?? 0) + (v ?? 0) * f;
  }
  // A budget has no balance sheet: the comparison's balance sheet is empty (shown as no comparison).
  return { P: plCalc(pl), B: bsCalc({}), label };
}

export interface VarianceCell { actual: number; budget: number; diff: number; pct: number | null }
export interface VarianceRow {
  key: string; label: string; cls: ClassKey;
  month: VarianceCell; ytd: VarianceCell;
  /** Actual to date plus the budget for the rest of the year. */
  outlook: number; fullYear: number;
  /** Better or worse for profit: income above budget and costs below it are better. */
  tone: "better" | "worse" | "neutral";
}

const cell = (actual: number, budget: number): VarianceCell =>
  ({ actual: r2(actual), budget: r2(budget), diff: r2(actual - budget), pct: budget ? r2(((actual - budget) / Math.abs(budget)) * 100) : null });

/**
 * Budget against actual, by budget line, for the month `end` and the year to it. An account budget ('#code' or '@name')
 * is compared with that account. A class that has a class line ('cls:…') or product totals is compared as ONE row: all
 * its budget against all its accounts, so no account is counted on two rows. P&L accounts spent with no budget are
 * listed with a budget of zero. partDay: the books stop on that day of `end`, whose budget then counts the same share
 * of its days (the rest of that month joins the outlook).
 */
export function varianceRows(actual: AccountLine[], budget: AccountLine[], months: string[], end: string, partDay?: number): VarianceRow[] {
  const share = compareWeight(partDay, end);
  const toDate = months.filter((m) => m <= end);
  const rest = months.filter((m) => m > end);
  const bsum = (a: AccountLine | undefined, ms: string[]) => ms.reduce((s, m) => s + (a?.amounts[m] ?? 0) * (m === end ? share : 1), 0);
  const asum = (a: AccountLine | undefined, ms: string[]) => ms.reduce((s, m) => s + (a?.amounts[m] ?? 0), 0);
  const isKey = (id: string) => id.startsWith("#") || id.startsWith("@");
  const actualPL = actual.filter((a) => PL_SET.has(a.cls));
  const classWide = new Set(budget.filter((b) => !isKey(b.id)).map((b) => b.cls));
  const rows: VarianceRow[] = [];
  const add = (key: string, label: string, cls: ClassKey, acts: AccountLine[], buds: AccountLine[]) => {
    const act = (ms: string[]) => acts.reduce((s, a) => s + asum(a, ms), 0);
    const bud = (ms: string[]) => buds.reduce((s, b) => s + bsum(b, ms), 0);
    const ytd = cell(act(toDate), bud(toDate));
    const good = INCOME.has(cls) ? ytd.diff > 0 : ytd.diff < 0;
    const endLeft = buds.reduce((s, b) => s + (b.amounts[end] ?? 0), 0) * (1 - share);
    rows.push({
      key, label, cls,
      month: cell(act([end]), bud([end])), ytd,
      outlook: r2(act(toDate) + endLeft + buds.reduce((s, b) => s + asum(b, rest), 0)),
      fullYear: r2(buds.reduce((s, b) => s + asum(b, months), 0)),
      tone: Math.abs(ytd.diff) < 0.5 ? "neutral" : good ? "better" : "worse",
    });
  };
  for (const cls of classWide) add(`class:${cls}`, cls, cls, actualPL.filter((a) => a.cls === cls), budget.filter((b) => b.cls === cls));
  const keyed = new Set<string>();
  for (const b of budget) {
    if (!isKey(b.id) || classWide.has(b.cls)) continue;
    keyed.add(b.id);
    add(b.id, b.name, b.cls, actualPL.filter((a) => accountMarkKey(a) === b.id), [b]);
  }
  for (const a of actualPL) {
    const k = accountMarkKey(a);
    if (keyed.has(k) || classWide.has(a.cls) || !asum(a, toDate)) continue;
    add(k, a.code ? `${a.code} ${a.name}` : a.name, a.cls, [a], []);
  }
  return rows;
}

/** Seeds a budget from last year: each P&L account's same month a year earlier, grown by pct (overall, or per class). */
export function seedFromLastYear(actual: AccountLine[], months: string[], pct: number | ({ all: number } & Partial<Record<ClassKey, number>>)): BudgetLine[] {
  const growth = (cls: ClassKey) => (typeof pct === "number" ? pct : pct[cls] ?? pct.all);
  const out: BudgetLine[] = [];
  for (const a of actual) {
    if (!PL_SET.has(a.cls)) continue;
    for (const m of months) {
      const ly = a.amounts[addMonths(m, -12)];
      if (!ly) continue;
      out.push({ key: accountMarkKey(a), cls: a.cls, label: a.code ? `${a.code} ${a.name}` : a.name, month: m, amount: r2(ly * (1 + growth(a.cls) / 100)) });
    }
  }
  return out;
}

/** Seeds a budget from the forecast: one line per class and month (the forecast works by class, not by account). */
export function seedFromForecast(forecastMonths: { period: string; pl: PLInput }[], months: string[]): BudgetLine[] {
  const inYear = new Set(months);
  const out: BudgetLine[] = [];
  for (const f of forecastMonths) {
    if (!inYear.has(f.period)) continue;
    for (const k of PL_KEYS) {
      const v = f.pl[k as keyof PLInput];
      if (!v) continue;
      out.push({ key: `cls:${k}`, cls: k as ClassKey, label: null, month: f.period, amount: r2(v) });
    }
  }
  return out;
}

/**
 * Seeds product rows from last year's sales: units grown by pct, last year's average price and (where costs were
 * recorded) unit cost, per product and month. Products sold with no quantities can't be budgeted by units: they are
 * returned in `skipped`.
 */
export function seedProducts(rows: SalesProductRow[], months: string[], pct: number): { rows: BudgetProduct[]; skipped: string[] } {
  const ly = new Map(months.map((m) => [addMonths(m, -12), m]));
  const agg = new Map<string, { product: string; category: string; month: string; q: number; a: number; k: number | null; ka: number }>();
  const skipped = new Set<string>();
  for (const r of rows) {
    const m = ly.get(r.p);
    if (!m) continue;
    if (r.q === null || !r.q) { skipped.add(r.r); continue; }
    const key = `${r.r}\u0001${m}`;
    const x = agg.get(key) ?? { product: r.r, category: r.g, month: m, q: 0, a: 0, k: 0, ka: 0 };
    x.q += r.q; x.a += r.a;
    if (r.k === null || x.k === null) x.k = null; else x.k += r.k;
    agg.set(key, x);
  }
  const out = [...agg.values()].filter((x) => x.q > 0).map((x) => ({
    product: x.product, category: x.category || null, month: x.month,
    units: r2(x.q * (1 + pct / 100)), price: r2(x.a / x.q), unit_cost: x.k === null ? null : r2(x.k / x.q),
  }));
  for (const p of out) skipped.delete(p.product);
  return { rows: out.sort((a, b) => a.product.localeCompare(b.product) || a.month.localeCompare(b.month)), skipped: [...skipped].sort() };
}

/**
 * Seeds a budget from last year with products: what was sold by unit becomes product rows (units grown by pct, last
 * year's price and unit cost), and in each month with products the rest of revenue (and of variable cost of sales, when
 * every product has a unit cost) is one class line, so the month's totals are last year's grown by pct. Other P&L
 * accounts, and months without products, are seeded by account as seedFromLastYear does.
 */
export function seedWithProducts(actual: AccountLine[], sales: SalesProductRow[], months: string[], pct: number): { lines: BudgetLine[]; products: BudgetProduct[]; skipped: string[] } {
  const { rows: products, skipped } = seedProducts(sales, months, pct);
  const byAccount = seedFromLastYear(actual, months, pct);
  const prodMonths = new Map<string, BudgetProduct[]>();
  for (const p of products) prodMonths.set(p.month, [...(prodMonths.get(p.month) ?? []), p]);
  const lines: BudgetLine[] = [];
  const total = (cls: ClassKey, m: string) => byAccount.filter((l) => l.cls === cls && l.month === m).reduce((s, l) => s + l.amount, 0);
  for (const [m, ps] of prodMonths) {
    const rev = r2(total("revenue", m) - ps.reduce((s, p) => s + p.units * p.price, 0));
    if (Math.abs(rev) >= 0.01) lines.push({ key: "cls:revenue", cls: "revenue", label: "Revenue not budgeted by product", month: m, amount: rev });
    if (ps.every((p) => p.unit_cost !== null)) {
      const cogs = r2(total("cos_variable", m) - ps.reduce((s, p) => s + p.units * (p.unit_cost ?? 0), 0));
      if (Math.abs(cogs) >= 0.01) lines.push({ key: "cls:cos_variable", cls: "cos_variable", label: "Cost of sales not budgeted by product", month: m, amount: cogs });
    }
  }
  for (const l of byAccount) {
    const ps = prodMonths.get(l.month);
    if (ps && (l.cls === "revenue" || (l.cls === "cos_variable" && ps.every((p) => p.unit_cost !== null)))) continue;
    lines.push(l);
  }
  return { lines, products, skipped };
}

export interface ProductVariance {
  product: string; budgetUnits: number; actualUnits: number | null; budget: number; actual: number;
  /** (actual units − budget units) × budget price; null when the actual units aren't known. */
  volume: number | null;
  /** (actual price − budget price) × actual units; null when the actual units aren't known. */
  price: number | null;
}

/** Revenue against budget per product over the months, split into a volume and a price effect that add up exactly. */
export function productVariance(budget: BudgetProduct[], actual: SalesProductRow[], months: string[]): ProductVariance[] {
  const inM = new Set(months);
  const m = new Map<string, { bu: number; br: number; au: number | null; ar: number }>();
  const get = (p: string) => m.get(p) ?? { bu: 0, br: 0, au: 0, ar: 0 };
  for (const b of budget) if (inM.has(b.month)) { const x = get(b.product); x.bu += b.units; x.br += b.units * b.price; m.set(b.product, x); }
  for (const a of actual) if (inM.has(a.p)) {
    const x = get(a.r);
    x.ar += a.a;
    x.au = a.q === null || x.au === null ? null : x.au + a.q;
    m.set(a.r, x);
  }
  return [...m.entries()].map(([product, x]) => {
    const bp = x.bu ? x.br / x.bu : 0;
    const ok = x.au !== null && (x.au !== 0 || x.ar === 0);
    const ap = ok && x.au ? x.ar / x.au : 0;
    return {
      product, budgetUnits: r2(x.bu), actualUnits: x.au === null ? null : r2(x.au), budget: r2(x.br), actual: r2(x.ar),
      volume: ok ? r2((x.au! - x.bu) * bp) : null,
      price: ok ? r2((ap - bp) * x.au!) : null,
    };
  }).sort((a, b) => Math.abs(b.actual - b.budget) - Math.abs(a.actual - a.budget));
}

/**
 * KPI targets from the budget for a window: revenue, gross margin, EBIT margin and net margin. Already for the whole
 * window (no monthly scaling). Targets typed by hand win (analyze applies these only where none is typed).
 */
export function budgetTargets(P: PLCalc): Record<string, number | null> {
  const R = P.revenue;
  const m = (x: number) => (R ? r2((x / R) * 100) : null);
  return { total_revenue: r2(R), gpm: m(P.gross_profit), profit_ratio: m(P.ebit), npat: m(P.eat) };
}

/** The budget whose financial year holds month `end` (each list entry is one year's chosen version), else null. */
export function budgetFor<T extends { fy: string }>(budgets: T[] | null | undefined, end: string, fyStart: number): T | null {
  const fy = fyStartOf(end, fyStart).slice(0, 4);
  return budgets?.find((b) => b.fy === fy) ?? null;
}

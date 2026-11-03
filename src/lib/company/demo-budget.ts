import { fyStartOf, hasPL, type MonthData } from "@/lib/engine";
import { fyMonths, type BudgetLine, type BudgetProduct } from "@/lib/engine/budget";
import type { SalesData } from "@/lib/engine/sales";
import type { ExpensesData } from "@/lib/engine/expenses";
import { budgetToLines, customerView, rowMonths, type BudgetRow, type BudgetSetup } from "@/lib/engine/budget-builder";
import { builderBases, startRows } from "@/lib/engine/budget-bases";
import { suggestSetup } from "@/lib/engine/budget-setup";
import { demoSales } from "./demo-sales";
import { demoExpenses } from "./demo-expenses";

/** Calendar-month seasonality of the made-up history (Jan..Dec): a quieter first quarter and a strong year end. */
const SEASON = [0.86, 0.84, 0.95, 0.98, 0.97, 0.93, 0.9, 0.95, 0.97, 1.06, 1.08, 1.1];
/** Cost classes that move with sales; the rest are the same every month. */
const VARIABLE = new Set(["cos_variable", "exp_variable"]);
const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * The data the demo budget was built from, as it stood when it was built (end of September of the year before the budget
 * year): the demo's own sales and costs for the months it has up to then, and a made-up history before them (the year
 * before and this year's first months) from the same mix of products, customers and accounts with a plausible
 * seasonality, so "this year to date" is part of the year and the estimate a full year.
 */
export function demoBudgetData(sales: SalesData, expenses: ExpensesData, fy: string) {
  const thisYear = String(Number(fy) - 1);
  const asOf = `${thisYear}-09`;
  const real = (p: string) => p <= asOf;
  const firstReal = [...sales.products.map((r) => r.p), ...expenses.accounts.map((r) => r.p)].filter(real).sort()[0] ?? asOf;
  // Every month from January of the year before this one up to the first month the demo has.
  const history: string[] = [];
  for (let y = Number(thisYear) - 1; y <= Number(thisYear); y++) for (let m = 1; m <= 12; m++) {
    const p = `${y}-${String(m).padStart(2, "0")}`;
    if (p < firstReal) history.push(p);
  }
  // Each row's average month over the demo's own months, taken as a 1.0 season month of this year.
  const seasonOf = (p: string) => SEASON[Number(p.slice(5, 7)) - 1];
  const growth = (p: string) => (p.startsWith(thisYear) ? 1 : 0.9);
  function extend<T extends { p: string; a: number }>(rows: T[], id: (r: T) => string, scale: (r: T, f: number) => T, fixed?: (r: T) => boolean): T[] {
    const mine = rows.filter((r) => real(r.p));
    // The mix: every month the demo has (a fuller picture than the few months up to `asOf`).
    const months = new Set(rows.map((r) => r.p));
    const seasonSum = [...months].reduce((t, p) => t + seasonOf(p) * (p > asOf ? 1.08 : 1), 0) || 1;
    const avg = new Map<string, { r: T; a: number }>();
    for (const r of rows) { const k = id(r); const x = avg.get(k) ?? { r, a: 0 }; x.a += r.a; avg.set(k, x); }
    const made: T[] = [];
    for (const [k, { r, a }] of avg) {
      // Each row its own swing around the season (from its name: the same every time), so the rows don't all look alike.
      let h = 7;
      for (const ch of k) h = (h * 31 + ch.charCodeAt(0)) % 9973;
      const amp = 0.4 + (h % 100) / 60, shift = h % 3;
      const own = (p: string) => 1 + (SEASON[(Number(p.slice(5, 7)) - 1 + shift) % 12] - 1) * amp;
      for (const p of history) {
        const flat = fixed?.(r) ?? false;
        const base = flat ? a / (months.size || 1) : a / seasonSum;
        // Fixed costs were lower before (rent and salaries rise once a year); sales follow the season and the growth.
        const f = flat ? (p.startsWith(thisYear) ? 0.95 : 0.88) : own(p) * growth(p);
        const amount = r2(base * f);
        if (amount) made.push(scale({ ...r, p, a: amount }, amount / (r.a || 1)));
      }
    }
    return [...made, ...mine];
  }
  const scaleN = (v: number | null, f: number) => (v === null ? null : r2(v * f));
  const products = extend(sales.products, (r) => `${r.r}|${r.g}|${r.s}`, (r, f) => ({ ...r, k: scaleN(r.k, f), ka: scaleN(r.ka, f), q: r.q === null ? null : Math.max(1, Math.round(r.q * f)) }));
  const customers = extend(sales.customers, (r) => `${r.c}|${r.s}|${r.sp}`, (r, f) => ({ ...r, k: scaleN(r.k, f), ka: scaleN(r.ka, f), q: r.q === null ? null : Math.max(1, Math.round(r.q * f)) }));
  const costs = extend(expenses.accounts, (r) => `${r.t}|${r.g}|${r.c}`, (r) => r, (r) => !VARIABLE.has(r.c ?? ""));
  return { products, customers, expenses: costs, asOf };
}

/**
 * The demo company's budget built with the budget builder (made up, nothing saved): a setup from `suggestSetup` on the
 * demo sales, two groups (Hospitals, Homecare) and the rental stream, then every row at this year's estimate
 * (`startRows`, from `demoBudgetData`) with a few changes: two revenue items up 10% and 15%, one down 5%, salaries up 8%.
 * The Customers rows follow the revenue, so the difference is 0.
 */
export function demoBuilderBudget(months: MonthData[], fyStart: number, sales: SalesData, expenses: ExpensesData) {
  const last = months.filter(hasPL).map((m) => m.period).pop() ?? "2026-01";
  const fy = fyStartOf(last, fyStart).slice(0, 4);
  const ms = fyMonths(fy, fyStart);
  const data = demoBudgetData(sales, expenses, fy);
  const sug = suggestSetup(data.products, { top: 10 });
  const byCategory = (cats: string[]) => [...new Set(data.products.filter((r) => cats.includes(r.g)).map((r) => r.r))].sort();
  const names = [...new Set(data.customers.map((r) => r.c))];
  const setup: BudgetSetup = {
    ...sug.setup,
    groups: [
      { id: "hospitals", name: "Hospitals", products: byCategory(["Respiratory Devices", "Mobility"]), customers: names.filter((n) => /Hospital/.test(n)).sort() },
      { id: "homecare", name: "Homecare", products: byCategory(["Consumables", "Patient Monitoring", "Service"]), customers: names.filter((n) => /Home Care/.test(n)).sort() },
    ],
  };
  const bb = builderBases({ products: data.products, customers: data.customers, expenses: data.expenses, stockCogs: [] }, setup, fy, fyStart);
  const start = startRows(bb);
  const change = (r: BudgetRow | undefined, pct: number) => {
    if (!r) return;
    r.basis = { kind: "pct", value: pct };
    r.months = rowMonths(r.basis, bb.byKey.get(r.key)!);
  };
  const rev = start.filter((r) => r.view === "revenue");
  const items = rev.filter((r) => r.key.startsWith("prod:"));
  change(items[0], 10);
  change(items[1], 15);
  change(items[3], -5);
  const exp = start.filter((r) => r.view === "expense");
  change(exp.find((r) => /Salaries/.test(r.label)) ?? exp.find((r) => r.cls === "exp_fixed"), 8);
  const total = Array.from({ length: 12 }, (_, i) => r2(rev.reduce((t, r) => t + r.months[i], 0)));
  const customers = bb.customer.length ? customerView(total, bb.customer, []).rows : [];
  const rows = [...rev, ...customers, ...exp];
  return { fy, name: `Budget FY ${fy}`, setup, rows, lines: budgetToLines(rows, ms), data };
}

/**
 * The demo's budget for the Financials "Budget" comparison and reports: the lines of the builder budget the demo budget
 * page shows, so the demo has one budget everywhere.
 */
export function demoCompareBudget(months: MonthData[], fyStart: number): { fy: string; name: string; status: "approved"; lines: BudgetLine[]; products: BudgetProduct[] } {
  const b = demoBuilderBudget(months, fyStart, demoSales(), demoExpenses());
  return { fy: b.fy, name: b.name, status: "approved", lines: b.lines, products: [] };
}

import { fyStartOf, hasPL, type MonthData } from "@/lib/engine";
import { fyMonths, type BudgetLine, type BudgetProduct } from "@/lib/engine/budget";
import type { SalesData } from "@/lib/engine/sales";
import type { ExpensesData } from "@/lib/engine/expenses";
import { budgetToLines, customerView, rowMonths, type BudgetSetup } from "@/lib/engine/budget-builder";
import { builderBases, startRows } from "@/lib/engine/budget-bases";
import { suggestSetup } from "@/lib/engine/budget-setup";
import { demoSales } from "./demo-sales";
import { demoExpenses } from "./demo-expenses";

/**
 * The demo company's budget built with the budget builder (made up, nothing saved): a setup from `suggestSetup` on the
 * demo sales, two groups (Hospitals, Homecare) and the rental stream, then rows from `startRows` with two rows changed
 * (+10% on one revenue item, edited months on another). The Customers rows follow the revenue, so the difference is 0.
 */
export function demoBuilderBudget(months: MonthData[], fyStart: number, sales: SalesData, expenses: ExpensesData) {
  const last = months.filter(hasPL).map((m) => m.period).pop() ?? "2026-01";
  const fy = fyStartOf(last, fyStart).slice(0, 4);
  const ms = fyMonths(fy, fyStart);
  const sug = suggestSetup(sales.products, { top: 10 });
  const byCategory = (cats: string[]) => [...new Set(sales.products.filter((r) => cats.includes(r.g)).map((r) => r.r))].sort();
  const setup: BudgetSetup = {
    ...sug.setup,
    groups: [
      { id: "hospitals", name: "Hospitals", products: byCategory(["Respiratory Devices", "Mobility"]), customers: [...new Set(sales.customers.map((r) => r.c))].filter((n) => /Hospital/.test(n)).sort() },
      { id: "homecare", name: "Homecare", products: byCategory(["Consumables", "Patient Monitoring", "Service"]), customers: [...new Set(sales.customers.map((r) => r.c))].filter((n) => /Home Care/.test(n)).sort() },
    ],
  };
  const bb = builderBases({ products: sales.products, customers: sales.customers, expenses: expenses.accounts, stockCogs: [] }, setup, fy, fyStart);
  const start = startRows(bb);
  const rev = start.filter((r) => r.view === "revenue");
  const up = rev[0], hand = rev[1];
  if (up) { up.basis = { kind: "pct", value: 10 }; up.months = rowMonths(up.basis, bb.byKey.get(up.key)!); }
  if (hand) { hand.mode = "months"; hand.basis = null; hand.months = hand.months.map((v, i) => Math.round(v * (i % 2 ? 1.08 : 0.96) * 100) / 100); }
  const total = Array.from({ length: 12 }, (_, i) => Math.round(rev.reduce((t, r) => t + r.months[i], 0) * 100) / 100);
  const customers = bb.customer.length ? customerView(total, bb.customer, []).rows : [];
  const rows = [...rev, ...customers, ...start.filter((r) => r.view === "expense")];
  return { fy, name: `Budget FY ${fy}`, setup, rows, lines: budgetToLines(rows, ms) };
}

/**
 * The demo's budget for the Financials "Budget" comparison and reports: the lines of the builder budget the demo budget
 * page shows, so the demo has one budget everywhere.
 */
export function demoCompareBudget(months: MonthData[], fyStart: number): { fy: string; name: string; status: "approved"; lines: BudgetLine[]; products: BudgetProduct[] } {
  const b = demoBuilderBudget(months, fyStart, demoSales(), demoExpenses());
  return { fy: b.fy, name: b.name, status: "approved", lines: b.lines, products: [] };
}

"use client";
import { useMemo } from "react";
import { useCompany } from "@/lib/company/context";
import { demoSales } from "@/lib/company/demo-sales";
import { demoExpenses } from "@/lib/company/demo-expenses";
import { demoBuilderBudget } from "@/lib/company/demo-budget";
import { BudgetPage } from "./budget-page";

/** The demo's budget page: one approved budget built with the budget builder (nothing is saved). */
export function DemoBudget() {
  const c = useCompany();
  const props = useMemo(() => {
    const data = demoSales();
    const expenses = demoExpenses();
    const b = demoBuilderBudget(c.months, c.settings.fyStartMonth ?? 1, data, expenses);
    return {
      versions: [{ id: "demo", fy: b.fy, name: b.name, kind: "original" as const, status: "approved" as const, basedOn: null, approvedAt: `${b.fy}-01-05`, createdAt: `${b.fy}-01-01`, updatedAt: `${b.fy}-01-05` }],
      current: { id: "demo", lines: b.lines, products: [], rows: b.rows, setup: b.setup },
      // The data as it stood when the budget was built (see demoBudgetData): the base columns read the same as the rows.
      salesProducts: b.data.products, salesCustomers: b.data.customers, expenseAccounts: b.data.expenses, setup: b.setup,
    };
  }, [c.months, c.settings.fyStartMonth]);
  return <BudgetPage {...props} demo />;
}

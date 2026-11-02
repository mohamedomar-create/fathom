"use client";
import { useMemo } from "react";
import { useCompany } from "@/lib/company/context";
import { demoSales } from "@/lib/company/demo-sales";
import { demoBudget } from "@/lib/company/demo-budget";
import { BudgetPage } from "./budget-page";

/** The demo's budget page: one approved budget (nothing is saved). */
export function DemoBudget() {
  const c = useCompany();
  const props = useMemo(() => {
    const sales = demoSales().products;
    const b = demoBudget(c.accounts, c.months, c.settings.fyStartMonth ?? 1, sales);
    return {
      versions: [{ id: "demo", fy: b.fy, name: b.name, kind: "original" as const, status: "approved" as const, basedOn: null, approvedAt: `${b.fy}-01-05`, createdAt: `${b.fy}-01-01` }],
      current: { id: "demo", lines: b.lines, products: b.products },
      salesProducts: sales,
    };
  }, [c.accounts, c.months, c.settings.fyStartMonth]);
  return <BudgetPage {...props} demo />;
}

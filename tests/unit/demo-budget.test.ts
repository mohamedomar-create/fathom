import { describe, expect, it } from "vitest";
import { demoCompany } from "@/lib/company/demo";
import { demoSales } from "@/lib/company/demo-sales";
import { demoExpenses } from "@/lib/company/demo-expenses";
import { demoBuilderBudget, demoCompareBudget } from "@/lib/company/demo-budget";

describe("demo budget", () => {
  it("Financials and reports compare with the same budget the demo budget page shows", () => {
    const c = demoCompany();
    const fyStart = c.settings.fyStartMonth ?? 1;
    const page = demoBuilderBudget(c.months, fyStart, demoSales(), demoExpenses());
    const cmp = demoCompareBudget(c.months, fyStart);
    expect(cmp).toEqual({ fy: page.fy, name: page.name, status: "approved", lines: page.lines, products: [] });
    expect(cmp.lines.some((l) => l.key === "cls:revenue")).toBe(true);
  });
});

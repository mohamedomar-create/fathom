import { describe, expect, it } from "vitest";
import { demoCompany } from "@/lib/company/demo";
import { demoSales } from "@/lib/company/demo-sales";
import { demoExpenses } from "@/lib/company/demo-expenses";
import { demoBuilderBudget, demoCompareBudget } from "@/lib/company/demo-budget";
import { builderBases } from "@/lib/engine/budget-bases";

describe("demo budget", () => {
  it("Financials and reports compare with the same budget the demo budget page shows", () => {
    const c = demoCompany();
    const fyStart = c.settings.fyStartMonth ?? 1;
    const page = demoBuilderBudget(c.months, fyStart, demoSales(), demoExpenses());
    const cmp = demoCompareBudget(c.months, fyStart);
    expect(cmp).toEqual({ fy: page.fy, name: page.name, status: "approved", lines: page.lines, products: [] });
    expect(cmp.lines.some((l) => l.key === "cls:revenue")).toBe(true);
  });

  it("tells a credible story: a full base year, a few changes on this year's estimate, a healthy margin", () => {
    const c = demoCompany();
    const b = demoBuilderBudget(c.months, c.settings.fyStartMonth ?? 1, demoSales(), demoExpenses());
    const bb = builderBases({ products: b.data.products, customers: b.data.customers, expenses: b.data.expenses, stockCogs: [] }, b.setup, b.fy, c.settings.fyStartMonth ?? 1);
    const rev = bb.revenue;
    const ytd = rev.reduce((t, r) => t + r.ytd, 0), est = rev.reduce((t, r) => t + r.estimate, 0);
    expect(ytd).toBeGreaterThan(0);
    expect(ytd).toBeLessThan(est * 0.9); // this year is not over: the estimate adds the months to come
    const estMonths = Array.from({ length: 12 }, (_, i) => rev.reduce((t, r) => t + r.months[i], 0));
    expect(estMonths.every((v) => v > 0)).toBe(true); // a full year, every month
    expect(Math.max(...estMonths) / Math.min(...estMonths)).toBeGreaterThan(1.1); // some seasonality
    // Every row starts at the estimate; a few are changed.
    const pcts = b.rows.filter((r) => r.basis?.kind === "pct" && r.basis.value !== 0).map((r) => `${r.view}:${(r.basis as { value: number }).value}`).sort();
    expect(pcts).toEqual(["expense:8", "revenue:-5", "revenue:10", "revenue:15"]);
    expect(b.rows.every((r) => r.view === "customer" || r.basis?.kind === "pct")).toBe(true);
    // Gross margin 40-50%, net margin 8-15%, the stock interim account not counted as a cost.
    let revenue = 0, cos = 0, rest = 0;
    for (const l of b.lines) {
      if (l.cls === "revenue") revenue += l.amount;
      else if (l.cls.startsWith("cos_")) cos += l.amount;
      else rest += ["other_income", "interest_income"].includes(l.cls) ? -l.amount : l.amount;
    }
    expect(b.lines.some((l) => /Stock Interim/.test(l.label ?? ""))).toBe(false);
    expect((revenue - cos) / revenue).toBeGreaterThan(0.4);
    expect((revenue - cos) / revenue).toBeLessThan(0.5);
    expect((revenue - cos - rest) / revenue).toBeGreaterThan(0.08);
    expect((revenue - cos - rest) / revenue).toBeLessThan(0.15);
    expect(revenue).not.toBeCloseTo(est, -3); // the revenue changed on the estimate
    expect(b.setup.streams.rental.length).toBeGreaterThan(0); // a rental stream to show
    // No row ends the year on an artefact: the last month is within 15% of the one before.
    for (const r of b.rows.filter((x) => x.view === "revenue")) {
      const [a, z] = r.months.slice(10);
      expect(Math.abs(z - a) / a, r.label).toBeLessThan(0.15);
    }
  });
});

// Phase 4b: WCAG 2.2 AA on every public and demo page, in English and Arabic, desktop and phone (axe-core).
import { expect, test } from "@playwright/test";
import { axeViolations } from "./crawl-helpers";

const PAGES = [
  "/", "/login", "/login?mode=signup", "/privacy", "/terms",
  "/demo/cash", "/demo/cash/in", "/demo/cash/out", "/demo/cash/cash", "/demo/cash/entries",
  "/demo/summary", "/demo/analysis/kpis", "/demo/analysis/explorer", "/demo/analysis/profitability", "/demo/analysis/cashflow", "/demo/analysis/growth",
  "/demo/analysis/trend", "/demo/analysis/goalseek", "/demo/planning", ...["sales", "costs", "funding", "statements", "scenarios", "report"].map((t) => `/demo/planning?tab=${t}`), "/demo/planning/budget", "/demo/doctor", "/demo/valuation", "/demo/valuation?view=expert", "/demo/valuation/methods", "/demo/valuation/assumptions", "/demo/analysis/forecast", "/demo/analysis/financials", "/demo/analysis/real-profit", "/demo/banking",
  "/demo/sales", "/demo/sales/products", "/demo/sales/customers", "/demo/sales/trend",
  "/demo/expenses", "/demo/expenses/accounts", "/demo/expenses/suppliers", "/demo/expenses/trend",
  "/demo/inventory", "/demo/inventory/products", "/demo/inventory/movements", "/demo/inventory/valuation",
  "/demo/payments", "/demo/payments/receivables", "/demo/payments/payables", "/demo/payments/flows",
  "/demo/reports", "/demo/data", "/demo/data/checks", "/demo/data/readiness", "/demo/data/upload",
  "/demo/settings/profile", "/demo/settings/chart-of-accounts", "/demo/settings/kpis", "/demo/settings/targets", "/demo/settings/alerts",
];


for (const lang of ["en", "ar"] as const) {
  test(`every public and demo page meets WCAG 2.2 AA (${lang})`, async ({ page, context, baseURL }) => {
    test.setTimeout(600_000);
    await context.addCookies([{ name: "lang", value: lang, url: baseURL! }]);
    const all: string[] = [];
    for (const u of PAGES) all.push(...(await axeViolations(page, u)));
    expect(all, all.join("\n")).toEqual([]);
  });
}

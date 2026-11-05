// Phase 4b: in Arabic, no page shows English sentences (runs of three or more Latin words), apart from names.
import { expect, test } from "@playwright/test";
import { englishOnArabicPage } from "./crawl-helpers";
import { demoCompany } from "@/lib/company/demo";
import { demoSales } from "@/lib/company/demo-sales";
import { demoExpenses } from "@/lib/company/demo-expenses";
import { demoInventory } from "@/lib/company/demo-inventory";
import { demoPayments } from "@/lib/company/demo-payments";
import { demoCashEntries } from "@/lib/cash/demo";

/** Every name in the made-up demo data (accounts, customers, suppliers, products): data, not interface text. */
function dataNames(): string[] {
  const out = new Set<string>();
  const walk = (v: unknown, depth: number) => {
    if (depth > 8 || v == null) return;
    if (typeof v === "string") { if (/[A-Za-z]{2}/.test(v) && !/[\u0600-\u06FF]/.test(v) && v.length > 3) out.add(v.trim()); return; }
    if (Array.isArray(v)) { for (const x of v.slice(0, 400)) walk(x, depth + 1); return; }
    if (typeof v === "object") for (const x of Object.values(v as Record<string, unknown>)) walk(x, depth + 1);
  };
  const c = demoCompany();
  walk([c.name, c.accounts, demoSales(), demoExpenses(), demoInventory(), demoPayments(), demoCashEntries("2026-11-01")], 0);
  return [...out].sort((a, b) => b.length - a.length);
}

const PAGES = [
  "/", "/login", "/privacy", "/terms",
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

test("every public and demo page reads in Arabic", async ({ page, context, baseURL }) => {
  test.setTimeout(600_000);
  await context.addCookies([{ name: "lang", value: "ar", url: baseURL! }]);
  const all: string[] = [];
  const names = dataNames();
  for (const u of PAGES) all.push(...(await englishOnArabicPage(page, u, names)));
  expect(all, all.join("\n")).toEqual([]);
});

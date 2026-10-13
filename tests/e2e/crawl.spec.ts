import { test } from "@playwright/test";
import { brokenLinks, expectClean, inspect, internalLinks, type PageIssues } from "./crawl-helpers";

/** Every page a visitor can reach without an account, in every period view, on desktop and phone. */
const ANALYSIS = ["summary", "analysis/kpis", "analysis/explorer", "analysis/profitability", "analysis/cashflow", "analysis/growth", "analysis/trend", "analysis/goalseek", "analysis/forecast", "analysis/financials", "banking", "analysis/real-profit", "sales", "sales/products", "sales/customers", "sales/trend"];
const SETTINGS = ["settings/data-setup", "settings/profile", "settings/source-data", "settings/data-health", "settings/chart-of-accounts", "settings/kpis", "settings/targets", "settings/alerts"];
const PUBLIC = ["/", "/login", "/login?mode=signup", "/privacy", "/terms", "/auth/reset"];

test("public pages and every demo page open cleanly", async ({ page }) => {
  test.setTimeout(240_000);
  const all: PageIssues[] = [];
  for (const u of PUBLIC) all.push(await inspect(page, u));
  for (const p of [...ANALYSIS, "reports", ...SETTINGS]) all.push(await inspect(page, `/demo/${p}`));
  expectClean(all);
});

test("demo pages work for a quarter, a year and each comparison", async ({ page }) => {
  test.setTimeout(240_000);
  const all: PageIssues[] = [];
  for (const p of ANALYSIS) {
    for (const q of ["type=quarter", "type=year", "cmp=prior", "cmp=ly"]) all.push(await inspect(page, `/demo/${p}?${q}`));
  }
  expectClean(all);
});

test("every link on the public and demo pages answers", async ({ page, request }) => {
  test.setTimeout(240_000);
  const links = new Set<string>();
  for (const u of [...PUBLIC, ...[...ANALYSIS, "reports", ...SETTINGS].map((p) => `/demo/${p}`)]) {
    await page.goto(u);
    for (const l of await internalLinks(page)) links.add(l);
  }
  const broken = await brokenLinks(request, [...links]);
  expectClean([{ url: `${links.size} links`, issues: broken }]);
});

test("unknown addresses get a proper not-found page", async ({ page }) => {
  const all = [
    await inspect(page, "/no-such-page", { expectStatus: 404 }),
    await inspect(page, "/r/not-a-real-token", { expectStatus: 404 }),
    await inspect(page, "/demo/analysis/no-such-view", { expectStatus: 404 }),
  ];
  expectClean(all);
});

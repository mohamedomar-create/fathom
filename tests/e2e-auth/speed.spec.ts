import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createCompany, newEmail, requireLocalStack, signUp } from "./helpers";

requireLocalStack();
// Timings vary with the machine: run on purpose (SPEED=1), not in every CI run.
test.skip(process.env.SPEED !== "1", "Speed test: run with SPEED=1 on the local stack");

/**
 * Speed on a company the size of a real Odoo user (150 accounts × 64 months, 31k expense lines, 17k sales lines, 22k
 * payments), under the live database limits: every page shows within its budget and the page never freezes for long.
 */
test("every page of a large company opens quickly and never freezes the page", async ({ page }) => {
  test.setTimeout(300_000);
  await signUp(page, { name: "Speed Owner", org: "Speed Advisory", email: newEmail("speed") });
  const id = await createCompany(page, "Speed Co");
  execFileSync("psql", [process.env.DB_URL ?? "postgres://postgres:postgres@127.0.0.1:54322/postgres", "-q", "-v", "ON_ERROR_STOP=1", "-v", `company='${id}'`, "-f", path.join(__dirname, "../../scripts/bench/seed-big.sql")]);
  // Every long task (the page frozen for 50 ms or more) is recorded.
  await page.addInitScript(() => {
    (window as unknown as { __long: number[] }).__long = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) (window as unknown as { __long: number[] }).__long.push(Math.round(e.duration)); }).observe({ type: "longtask", buffered: true });
  });
  const pages: [string, string][] = [
    ["summary", "main"], ["analysis/financials", "main"], ["sales", "[data-testid=sales-headline]"], ["expenses", "[data-testid=expenses-headline]"],
    ["payments/flows?type=month&end=2026-09", "main"], ["data", "[data-testid=data-steps]"], ["data/checks", "[data-testid=health-calendar]"], ["reports", "main"],
  ];
  const rows: { page: string; ms: number; longest: number; server: number; download: number; kb: number }[] = [];
  for (const [p, sel] of pages) {
    const t0 = Date.now();
    await page.goto(`/company/${id}/${p}`);
    await page.locator(sel).first().waitFor({ timeout: 30_000 });
    const ms = Date.now() - t0;
    await page.waitForTimeout(300);
    const longest = await page.evaluate(() => Math.max(0, ...(window as unknown as { __long: number[] }).__long));
    // Where the time went: the server's answer (first byte), the download, and its size.
    const nav = await page.evaluate(() => { const n = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming; return { server: Math.round(n.responseStart - n.requestStart), download: Math.round(n.responseEnd - n.responseStart), kb: Math.round(n.transferSize / 1024) }; });
    rows.push({ page: p, ms, longest, ...nav });
  }
  console.log(JSON.stringify(rows));
  for (const r of rows) {
    expect.soft(r.ms, `${r.page} took ${r.ms} ms`).toBeLessThan(2500);
    expect.soft(r.longest, `${r.page} froze for ${r.longest} ms`).toBeLessThan(300);
  }
});

/** The Data section on the same large company: every tab, opened by clicking its tab as a person does, opens quickly. */
test("the Data tabs open quickly one after another on a large company", async ({ page }) => {
  test.setTimeout(300_000);
  await signUp(page, { name: "Data Speed", org: "Data Speed Advisory", email: newEmail("dspeed") });
  const id = await createCompany(page, "Data Speed Co");
  execFileSync("psql", [process.env.DB_URL ?? "postgres://postgres:postgres@127.0.0.1:54322/postgres", "-q", "-v", "ON_ERROR_STOP=1", "-v", `company='${id}'`, "-f", path.join(__dirname, "../../scripts/bench/seed-big.sql")]);
  await page.goto(`/company/${id}/data`);
  await page.getByTestId("data-steps").waitFor({ timeout: 60_000 });
  const tabs: [string, string][] = [["Upload", "[data-testid=wiz-steps]"], ["Checks & history", "[data-testid=health-calendar]"], ["Readiness", "[data-testid=readiness-overview]"], ["End users", "[data-testid=end-user-choices]"], ["Odoo live", "main button:has-text(\"Test connection\")"], ["Steps", "[data-testid=data-steps]"]];
  const rows: { tab: string; ms: number }[] = [];
  for (const [label, sel] of tabs) {
    const t0 = Date.now();
    await page.getByTestId("data-nav").getByRole("link", { name: label }).click();
    await page.locator(sel).first().waitFor({ timeout: 60_000 });
    rows.push({ tab: label, ms: Date.now() - t0 });
  }
  console.log(JSON.stringify(rows));
  for (const r of rows) expect.soft(r.ms, `${r.tab} took ${r.ms} ms`).toBeLessThan(1500);
});

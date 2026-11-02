// Phase 4c: on a phone, an entry in three taps (amount, in or out, Save) saved on today's date; a category chosen for a
// customer is learned and offered for that customer next time; the learned rule is listed in Settings and can be forgotten.
import { execFileSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { newEmail, requireLocalStack, signUp } from "./helpers";

requireLocalStack();
const DB = process.env.DB_URL ?? "postgres://postgres:postgres@127.0.0.1:54322/postgres";
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function pad(page: Page, digits: string) {
  for (const k of digits) await page.getByTestId(`quick-key-${k === "." ? "dot" : k}`).click();
}
const cairoToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

test("three taps on a phone save today's entry; the category learned for a customer comes back for that customer", async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, { name: "Quick Owner", org: "Quick Advisory", email: newEmail("quick") });
  await page.goto("/companies");
  await page.getByTestId("add-company").click();
  await page.getByTestId("tile-simple").click();
  await page.getByLabel("Company name").fill("Quick Kiosk");
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(/\/cash\/[0-9a-f-]{36}$/);
  const id = page.url().match(/\/cash\/([0-9a-f-]{36})/)![1];
  const today = cairoToday();

  // Three taps: the amount, money out, Save. Nothing else is asked.
  await page.getByTestId("cash-bottom-add").click();
  const sheet = page.getByTestId("quick-entry");
  await expect(sheet).toBeVisible();
  await pad(page, "50");
  await page.getByTestId("quick-out").click();
  await page.getByTestId("quick-save").click();
  await expect(page.getByTestId("quick-msg")).toContainText("Saved: EGP 50", { timeout: 15_000 });
  await expect(page.getByTestId("quick-amount")).toHaveValue("");

  // Saving without saying in or out says what is missing.
  await pad(page, "12.5");
  await page.getByTestId("quick-save").click();
  await expect(page.getByTestId("quick-msg")).toContainText("Choose money in or money out.");

  // A sale to Nile Cafe, its category typed once.
  await page.getByTestId("quick-in").click();
  await page.getByTestId("quick-more").click();
  await page.getByTestId("quick-party").fill("Nile Cafe");
  await page.getByTestId("quick-chip-other").click();
  await page.getByTestId("quick-category").fill("Drinks");
  await page.getByTestId("quick-save").click();
  await expect(page.getByTestId("quick-msg")).toContainText("Saved: EGP 12.50", { timeout: 15_000 });

  // Next time, the same customer (typed differently) is offered Drinks without choosing it.
  await pad(page, "80");
  await page.getByTestId("quick-in").click();
  await page.getByTestId("quick-party").fill("  nile CAFE");
  const drinks = page.getByTestId("quick-chip").filter({ hasText: "Drinks" });
  await expect(drinks).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });
  await expect(drinks).toContainText("suggested");
  await page.getByTestId("quick-save").click();
  await expect(page.getByTestId("quick-msg")).toContainText("Saved: EGP 80", { timeout: 15_000 });
  // The open sheet, with its suggestion, meets WCAG 2.2 AA in English and Arabic.
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const lang of ["en", "ar"]) {
    if (lang === "ar") { await page.keyboard.press("Escape"); await page.context().addCookies([{ name: "lang", value: "ar", url: page.url() }]); await page.reload(); await page.getByTestId("cash-bottom-add").click(); }
    await pad(page, "9");
    await page.getByTestId("quick-in").click();
    const a = await new AxeBuilder({ page }).include("[data-testid=quick-entry]").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(a.violations.map((v) => `${lang} ${v.id}: ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);
  }
  await page.keyboard.press("Escape");
  await page.context().addCookies([{ name: "lang", value: "en", url: page.url() }]);

  // All three are on today's date, with the kind worked out and the learned category.
  await page.goto(`/cash/${id}/entries`);
  const rows = page.getByTestId("entries-row");
  await expect(rows).toHaveCount(3, { timeout: 15_000 });
  for (const r of await rows.all()) await expect(r).toContainText(today);
  await expect(rows.filter({ hasText: "80" })).toContainText("Drinks");
  await expect(rows.filter({ hasText: "50" }).filter({ hasText: "Out" })).toContainText("Expense");
  // The table's own add row starts on today too, and follows what it learned.
  await expect(page.getByTestId("add-day")).toHaveValue(today);
  await page.getByTestId("add-party").fill("Nile Cafe");
  await expect(page.getByTestId("add-category")).toHaveValue("Drinks");
  // Another name, saved at once: the previous customer's category is never carried over to it.
  await page.getByTestId("add-amount").fill("15");
  await page.getByTestId("add-party").fill("Walk-in buyer");
  await page.getByTestId("entries-add").click();
  const walkIn = page.getByTestId("entries-row").filter({ hasText: "Walk-in buyer" });
  await expect(walkIn).toHaveCount(1, { timeout: 15_000 });
  await expect(walkIn).not.toContainText("Drinks");

  // The learned rule is listed and can be forgotten.
  await page.goto(`/cash/${id}/settings`);
  const rule = page.getByTestId("cash-rule").filter({ hasText: "nile cafe" });
  await expect(rule).toContainText("Drinks");
  await expect(rule).toContainText("used 2×");
  await rule.getByTestId("cash-rule-forget").click();
  await expect(page.getByTestId("cash-rules-none")).toBeVisible({ timeout: 15_000 });

  // A business with thousands of customers: 3,000 learned names, every one kept, listed 50 at a time with the total,
  // found by search beyond the first page, suggested for an old customer, and forgotten.
  execFileSync("psql", [DB, "-q", "-c", `insert into public.cash_category_rules (company_id, direction, match_on, match, category, kind, last_used)
    select '${id}', 'in', 'party', 'customer ' || g, 'Wholesale ' || (g % 7), 'sale', now() - make_interval(mins => g) from generate_series(1, 3000) g`]);
  await page.reload();
  await expect(page.getByTestId("cash-rule")).toHaveCount(50, { timeout: 15_000 });
  await expect(page.getByTestId("cash-rules-count")).toHaveText("1–50 of 3,000");
  await page.getByTestId("cash-rules-older").click();
  await expect(page.getByTestId("cash-rules-count")).toHaveText("51–100 of 3,000");
  await page.getByTestId("cash-rules-search").fill("customer 2999");
  await expect(page.getByTestId("cash-rule")).toHaveCount(1, { timeout: 15_000 });
  await expect(page.getByTestId("cash-rule")).toContainText("Wholesale 3");

  // The oldest customer still gets their category in quick entry.
  await page.getByTestId("cash-bottom-add").click();
  await pad(page, "40");
  await page.getByTestId("quick-in").click();
  await page.getByTestId("quick-more").click();
  await page.getByTestId("quick-party").fill("Customer 2999");
  await expect(page.getByTestId("quick-chip").filter({ hasText: "Wholesale 3" })).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });
  await page.keyboard.press("Escape");

  await page.getByTestId("cash-rule").getByTestId("cash-rule-forget").click();
  await expect(page.getByTestId("cash-rules-none")).toContainText("No learned category matches", { timeout: 15_000 });
});

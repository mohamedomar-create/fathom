import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test("the cash book's 'still to be paid' ageing shows each bucket on its own, labelled, never run together", async ({ page }) => {
  await page.goto("/demo/cash/in");
  const box = page.getByTestId("side-unpaid-in");
  await expect(box).toBeVisible();
  const cells = box.locator("[data-age-bucket]");
  await expect(cells).toHaveCount(5);
  const rects = [];
  for (const c of await cells.all()) {
    await expect(c).toContainText(/\d/);
    rects.push((await c.boundingBox())!);
  }
  // No two buckets touch: each has its own space.
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
    expect(apart, `bucket ${i} and ${j} overlap`).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("the cash book entries read as cards on a phone: dates and amounts on one line, no sideways scroll", async ({ page }) => {
  await page.goto("/demo/cash/entries");
  const card = page.getByTestId("entry-card").first();
  await expect(card).toBeVisible();
  const date = card.getByTestId("entry-card-date");
  const h = (await date.boundingBox())!.height;
  expect(h).toBeLessThan(28); // one line, not "2026-/10-31"
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

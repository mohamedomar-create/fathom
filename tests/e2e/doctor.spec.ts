import { expect, test } from "@playwright/test";

// The AI system doctor in the demo: its own top tab, the score, findings ranked by money at stake, no AI or accepting.
test("the doctor tab shows the score and the findings ranked by money at stake", async ({ page }) => {
  await page.goto("/demo/summary");
  if (test.info().project.name === "desktop") await page.getByTestId("tab-doctor").click();
  else await page.goto("/demo/doctor");
  await expect(page).toHaveURL(/\/demo\/doctor/);
  await expect(page.getByTestId("doctor-score")).toHaveText(/^\d{1,3}$/);
  const cards = page.getByTestId("doctor-finding");
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThan(0);
  await expect(page.getByTestId("doctor-demo-note")).toBeVisible();
  await expect(page.getByTestId("doctor-accept")).toHaveCount(0);
  await expect(page.getByTestId("doctor-explain")).toHaveCount(0);
});

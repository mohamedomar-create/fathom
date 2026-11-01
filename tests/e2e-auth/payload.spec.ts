// Page weight budget (3c): the first answer of each main company page (its HTML with the data the page carries) on the
// large made-up company (scripts/bench/seed-big.sql) stays within the size measured on 1 Nov 2026 plus 20%. A change
// that makes a page send much more data fails here instead of slowing every user down.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createCompany, newEmail, requireLocalStack, signUp } from "./helpers";

requireLocalStack();

const DB = process.env.DB_URL ?? "postgres://postgres:postgres@127.0.0.1:54322/postgres";
/** Kilobytes measured on 1 Nov 2026 (uncompressed first answer). The budget is 20% above. */
const MEASURED_KB: Record<string, number> = {
  summary: 309, "analysis/financials": 299, sales: 4669, expenses: 3936, "payments/flows": 6193, data: 300, "data/checks": 386, reports: 273,
};

test("each main page of a large company stays within its size budget", async ({ page }) => {
  test.setTimeout(300_000);
  await signUp(page, { name: "Weight Owner", org: "Weight Advisory", email: newEmail("weight") });
  const id = await createCompany(page, "Weight Co");
  execFileSync("psql", [DB, "-q", "-v", "ON_ERROR_STOP=1", "-v", `company='${id}'`, "-f", path.join(__dirname, "../../scripts/bench/seed-big.sql")]);
  execFileSync("psql", [DB, "-q", "-c", `update private.summary_marks set marked_at = now() - interval '1 minute' where company_id = '${id}'`, "-c", "select private.refresh_summary_rollups(10)"]);
  const sizes: Record<string, number> = {};
  for (const p of Object.keys(MEASURED_KB)) {
    const res = await page.goto(`/company/${id}/${p}`);
    expect(res?.status(), p).toBe(200);
    sizes[p] = Math.round((await res!.body()).length / 1024);
  }
  console.log(JSON.stringify({ payloadKb: sizes }));
  for (const [p, kb] of Object.entries(sizes)) {
    expect.soft(kb, `${p}: ${kb} KB against a budget of ${Math.round(MEASURED_KB[p] * 1.2)} KB`).toBeLessThanOrEqual(Math.round(MEASURED_KB[p] * 1.2));
  }
});

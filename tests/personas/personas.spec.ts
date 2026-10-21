import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { expect, devices, test, type Page } from "@playwright/test";
import { createCompany, fixture, importFiles, newEmail, PASSWORD, signIn, signUp, startUpload } from "../e2e-auth/helpers";
import { persona, type Run } from "./harness";

test.skip(process.env.PERSONAS !== "1", "Persona runs need the local stack: PERSONAS=1 (see scripts/personas/run.sh)");

const DB = process.env.LOCAL_DB_URL ?? process.env.DB_URL ?? "postgresql://postgres@127.0.0.1:54322/postgres";
const sql = (q: string) => execFileSync("psql", [DB, "-tAqc", q], { encoding: "utf8" }).trim();

const FIN = ["summary", "analysis/kpis", "analysis/explorer", "analysis/profitability", "analysis/cashflow", "analysis/growth", "analysis/trend", "analysis/goalseek", "analysis/forecast", "analysis/financials", "banking", "analysis/real-profit"];
const SALES = ["sales", "sales/products", "sales/customers", "sales/trend", "sales/end-users"];
const EXP = ["expenses", "expenses/accounts", "expenses/suppliers", "expenses/trend"];
const INV = ["inventory", "inventory/products", "inventory/movements", "inventory/valuation"];
const PAY = ["payments", "payments/receivables", "payments/payables", "payments/flows"];
const DATA = ["data", "data/upload", "data/checks", "data/readiness", "data/odoo", "data/end-users"];
const SET = ["settings/profile", "settings/chart-of-accounts", "settings/kpis", "settings/targets", "settings/alerts"];
const ALL = [...FIN, ...SALES, ...EXP, ...INV, ...PAY, ...DATA, ...SET, "reports"];

/** Text that must never appear when nothing has been loaded: a zero dressed up as a figure. */
const FALSE_ZERO = /EGP 0(?!\.\d*[1-9])\b|EGP\s?0\.00/;

async function owner(run: Run, tag: string, opts: { files?: string[]; sales?: boolean; expenses?: boolean; payments?: boolean; page?: Page } = {}) {
  const page = opts.page ?? (await run.page());
  const email = newEmail(tag);
  let id = "";
  await run.step("sign up", () => signUp(page, { name: `${tag} Owner`, org: `${tag} Advisory`, email }), { critical: true });
  await run.step("create company", async () => { id = await createCompany(page, `${tag} Co`); }, { critical: true });
  if (opts.files) await run.step(`upload ${opts.files.join(" + ")}`, () => importFiles(page, id, opts.files!), { critical: true });
  if (opts.sales) await run.step("upload sales", () => uploadSales(page, id), { critical: true });
  if (opts.expenses) await run.step("upload vendor bills", () => uploadExpenses(page, id), { critical: true });
  if (opts.payments) await run.step("upload ageing + payments", () => uploadPayments(page, id), { critical: true });
  return { page, id, email };
}
async function uploadSales(page: Page, id: string) {
  await startUpload(page, id, "sales");
  await page.getByTestId("file-input").setInputFiles(fixture("odoo-invoice-analysis.xlsx"));
  await page.getByTestId("sales-next").click({ timeout: 20_000 });
  await page.getByTestId("save-sales").click();
  await expect(page.getByTestId("done-step")).toBeVisible({ timeout: 45_000 });
}
async function uploadExpenses(page: Page, id: string) {
  await startUpload(page, id, "expenses");
  await page.getByTestId("file-input").setInputFiles(fixture("odoo-vendor-bills.xlsx"));
  await page.getByTestId("expenses-next").click({ timeout: 20_000 });
  await page.getByTestId("save-expenses").click();
  await expect(page.getByTestId("done-step")).toBeVisible({ timeout: 45_000 });
}
async function uploadPayments(page: Page, id: string) {
  await startUpload(page, id, "payments");
  await page.getByTestId("file-input").setInputFiles([fixture("odoo-aged-receivable.xlsx"), fixture("odoo-aged-payable.xlsx"), fixture("odoo-payments.xlsx")]);
  await expect(page.getByTestId("payments-check")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("save-payments").click();
  await expect(page.getByTestId("done-step")).toBeVisible({ timeout: 45_000 });
}
async function tour(run: Run, page: Page, id: string, paths: string[], label: string) {
  await run.step(label, async () => { for (const p of paths) await run.visit(page, `/company/${id}/${p}`); });
}
async function invite(run: Run, page: Page, email: string, role: "viewer" | "editor" | "admin") {
  await run.step(`invite ${role}`, async () => {
    await page.goto("/admin/people");
    await page.getByPlaceholder("colleague@firm.com").fill(email);
    await page.locator("select").first().selectOption(role);
    await page.getByRole("button", { name: "Invite a person" }).click();
    await expect(page.getByRole("cell", { name: email })).toBeVisible();
  }, { critical: true });
}
const randomBytes = (n: number) => Buffer.from(Array.from({ length: n }, () => Math.floor(Math.random() * 256)));

// ───────────────────────────── Visitors (signed out)

persona("P01", "First-time visitor", "Reads the landing page, legal pages, then tries the demo", async (run) => {
  const page = await run.page();
  await run.step("landing, privacy, terms", async () => { for (const u of ["/", "/privacy", "/terms", "/login"]) await run.visit(page, u); });
  await run.step("open the demo from the landing page", async () => {
    await run.visit(page, "/");
    await page.locator('a[href^="/demo"]').first().click();
    await expect(page).toHaveURL(/\/demo/);
  });
});

persona("P02", "Demo explorer (desktop)", "Clicks through every demo page", async (run) => {
  const page = await run.page();
  await run.step("every demo page", async () => { for (const p of ALL.filter((p) => !p.startsWith("data/odoo") && !p.startsWith("data/end-users"))) await run.visit(page, `/demo/${p}`); });
});

persona("P03", "Demo explorer on a phone", "Browses the demo on a Pixel 7", async (run) => {
  const page = await run.page({ ...devices["Pixel 7"] });
  await run.step("demo pages on a phone", async () => { for (const p of ["summary", "sales", "expenses", "inventory", "payments", "banking", "analysis/cashflow", "data"]) await run.visit(page, `/demo/${p}`); });
  await run.step("switch sector from the phone nav", async () => {
    await run.visit(page, "/demo/summary");
    await page.getByTestId("sector-sales").filter({ visible: true }).first().click();
    await expect(page).toHaveURL(/\/demo\/sales/);
  });
});

persona("P04", "Arabic-speaking visitor", "Switches the site to Arabic and reads the demo right to left", async (run) => {
  const page = await run.page({ locale: "ar-EG" });
  await run.step("open demo", () => run.visit(page, "/demo/summary").then(() => {}));
  await run.step("switch to Arabic", async () => {
    const sw = page.getByTestId("lang-switch").filter({ visible: true }).first();
    if (!(await sw.isVisible())) { await page.getByTestId("user-menu").click(); }
    await page.getByTestId("lang-switch").filter({ visible: true }).first().click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl", { timeout: 10_000 });
  });
  await run.step("Arabic pages read without English leftovers in headings", async () => {
    for (const p of ["summary", "sales", "expenses", "banking", "data/upload", "settings/profile"]) {
      await run.visit(page, `/demo/${p}`);
      const h = (await page.locator("h1").first().innerText().catch(() => "")).trim();
      run.check(!/^[A-Za-z][A-Za-z &]+$/.test(h), "low", `Arabic mode: page heading still English on /demo/${p}: "${h}"`, page.url());
    }
  });
});

persona("P05", "Keyboard-only user", "Signs in using only the keyboard", async (run) => {
  const page = await run.page();
  await run.step("tab through the sign-in form", async () => {
    await run.visit(page, "/login");
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      seen.push(await page.evaluate(() => { const a = document.activeElement as HTMLElement | null; return a ? `${a.tagName}:${a.getAttribute("aria-label") ?? a.getAttribute("name") ?? a.textContent?.trim().slice(0, 20) ?? ""}` : ""; }));
    }
    run.check(seen.some((s) => /INPUT/.test(s)), "medium", `Keyboard: Tab never reaches the email field (${seen.join(", ")})`);
    const outline = await page.evaluate(() => { const a = document.activeElement as HTMLElement; const s = getComputedStyle(a); return s.outlineStyle !== "none" || s.boxShadow !== "none"; });
    run.check(outline, "low", "Keyboard: the focused element shows no focus ring");
  });
});

persona("P06", "Deep-linker without an account", "Opens bookmarked company and admin URLs while signed out", async (run) => {
  const page = await run.page({ expect4xx: /./ });
  await run.step("private URLs send to sign-in", async () => {
    for (const u of ["/companies", "/dashboard", "/account", "/admin/people", "/company/00000000-0000-0000-0000-000000000000/summary"]) {
      await page.goto(u);
      run.check(/\/login/.test(page.url()), "high", `Signed out: ${u} did not redirect to sign-in (landed on ${page.url()})`, u);
    }
  });
  await run.step("API refuses without a session", async () => {
    const r = await page.request.get("/api/export/00000000-0000-0000-0000-000000000000");
    run.check([401, 403, 404].includes(r.status()), "high", `Signed out: /api/export returned ${r.status()}`);
  });
});

persona("P07", "URL tamperer", "Edits the URL by hand: bad ids, long strings, path tricks", async (run) => {
  const { page, id } = await owner(run, "tamper", { files: ["odoo-pl-bs.xlsx"] });
  await run.step("malformed ids and paths", async () => {
    for (const u of [`/company/not-a-uuid/summary`, `/company/${id}/nope`, `/company/${id}/summary?type=decade`, `/company/${id}/summary?end=2099-13`, `/company/${id}/summary?end=${"9".repeat(300)}`, `/company/${id}/reports/00000000-0000-0000-0000-000000000000`, `/r/not-a-token`, `/company/${id}/../../admin/people`]) {
      const res = await page.goto(u);
      const st = res?.status() ?? 0;
      run.check(st < 500, "high", `Tampered URL ${u.replace(id, ":id").slice(0, 80)} gave a server error ${st}`, u);
      const body = await page.locator("body").innerText().catch(() => "");
      run.check(!/at Object\.|TypeError|ReferenceError|stack/.test(body), "high", `Tampered URL ${u.replace(id, ":id").slice(0, 80)} shows a stack trace`, u);
    }
  });
});

persona("P08", "Sign-up form tester", "Tries to sign up with empty, invalid and weak details", async (run) => {
  const page = await run.page({ expect4xx: /auth|token|signup/ });
  await run.step("empty form is refused with a reason", async () => {
    await run.visit(page, "/login?mode=signup");
    await page.getByRole("button", { name: "Create account" }).last().click();
    await page.waitForTimeout(500);
    run.check(/\/login/.test(page.url()), "high", "Empty sign-up form left the login page");
  });
  await run.step("bad email and a 3-letter password", async () => {
    await page.getByLabel("Your name").fill("X");
    await page.getByLabel("Firm or company name").fill("Y");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password").fill("abc");
    await page.getByRole("button", { name: "Create account" }).last().click();
    await page.waitForTimeout(1500);
    run.check(/\/login/.test(page.url()), "high", "Invalid sign-up details were accepted");
  });
  await run.step("same email twice", async () => {
    const email = newEmail("dup");
    await signUp(page, { name: "Dup", org: "Dup Org", email });
    await page.context().clearCookies();
    await page.goto("/login?mode=signup");
    await page.getByLabel("Your name").fill("Dup2");
    await page.getByLabel("Firm or company name").fill("Dup Org 2");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).last().click();
    await page.waitForTimeout(2000);
    const msg = await page.getByRole("status").innerText().catch(() => "");
    run.check(/\/login/.test(page.url()) && msg.length > 0, "medium", `Re-using an email: no clear message (url ${page.url()}, message "${msg}")`);
  });
});

persona("P09", "Forgetful user", "Types the wrong password repeatedly, then asks for a reset", async (run) => {
  const page = await run.page({ expect4xx: /auth|token|recover/ });
  const email = newEmail("forget");
  await run.step("sign up and out", async () => { await signUp(page, { name: "Forget", org: "Forget Org", email }); await page.context().clearCookies(); }, { critical: true });
  await run.step("six wrong passwords", async () => {
    for (let i = 0; i < 6; i++) {
      await signIn(page, email, `wrong-${i}-pass`);
      await expect(page.getByRole("status")).toBeVisible({ timeout: 10_000 });
    }
    const msg = await page.getByRole("status").innerText();
    run.check(/not right|too many|wait/i.test(msg), "medium", `Wrong password message unclear: "${msg}"`);
  });
  await run.step("forgot password", async () => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: /forgot/i }).click();
    await expect(page.getByRole("status")).toBeVisible({ timeout: 10_000 });
  });
  await run.step("right password still works", async () => {
    await signIn(page, email);
    await expect(page).toHaveURL(/\/companies|\/dashboard/, { timeout: 15_000 });
  });
});

persona("P10", "Shared-report reader", "Opens a published report link without an account, then after it is withdrawn", async (run) => {
  const { page, id } = await owner(run, "share", { files: ["odoo-pl-bs.xlsx"] });
  let link = "";
  await run.step("publish a report", async () => {
    await run.visit(page, `/company/${id}/reports`);
    await page.getByTestId("create-report").click();
    await expect(page).toHaveURL(/\/reports\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await page.getByRole("button", { name: "Publish report" }).click();
    link = await page.locator('input[readonly][value*="/r/"]').inputValue();
  }, { critical: true });
  const visitor = await run.page({ expect4xx: /\/r\// });
  await run.step("visitor reads the report", async () => { await run.visit(visitor, link); });
  await run.step("withdrawn link is gone", async () => {
    await page.getByRole("button", { name: "Stop sharing" }).click();
    await expect(page.getByRole("button", { name: "Publish report" })).toBeVisible();
    const r = await visitor.goto(link);
    run.check((r?.status() ?? 0) === 404, "high", `Withdrawn report link still answers ${r?.status()}`);
  });
});

// ───────────────────────────── New owners and uploads

persona("P11", "Brand-new owner with no data", "Signs up, creates a company and opens every page before uploading anything", async (run) => {
  const { page, id } = await owner(run, "empty");
  await run.step("every page of an empty company", async () => {
    for (const p of ALL) {
      await run.visit(page, `/company/${id}/${p}`);
      const text = await page.locator("main").innerText().catch(() => "");
      run.check(!FALSE_ZERO.test(text), "high", `Empty company shows a zero figure as if real on /${p}`, page.url());
    }
  });
});

persona("P12", "Odoo GL accountant", "Uploads GL + TB + P&L together and reads every financial page", async (run) => {
  const { page, id } = await owner(run, "gl", { files: ["egypt-odoo-general-ledger.xlsx", "egypt-odoo-trial-balance.xlsx", "egypt-odoo-profit-and-loss.xlsx"] });
  await tour(run, page, id, FIN, "financial pages");
  await tour(run, page, id, [...SALES, ...EXP], "sales and expenses derived from the ledger");
  await tour(run, page, id, DATA, "data section");
});

persona("P13", "Statements-only owner", "Uploads a P&L + balance sheet export and checks the headline", async (run) => {
  const { page, id } = await owner(run, "plbs", { files: ["odoo-pl-bs.xlsx"] });
  await run.step("headline figure", async () => {
    await run.visit(page, `/company/${id}/summary`);
    await expect(page.getByTestId("headline")).toContainText("EGP 1,066,138");
  });
  await tour(run, page, id, FIN, "financial pages");
});

persona("P14", "Trial-balance-only owner", "Uploads only a trial balance", async (run) => {
  const { page, id } = await owner(run, "tb", { files: ["odoo-trial-balance.xlsx"] });
  await tour(run, page, id, ["summary", "analysis/financials", "analysis/kpis", "banking", "data", "data/checks", "data/readiness"], "pages after a TB");
});

persona("P15", "Sales manager", "Uploads Invoice Analysis and studies customers and products", async (run) => {
  const { page, id } = await owner(run, "sales", { sales: true });
  await tour(run, page, id, SALES, "sales pages");
  await run.step("product and customer tables show figures", async () => {
    await run.visit(page, `/company/${id}/sales/products`);
    await expect(page.getByTestId("product-table")).toBeVisible();
    await run.visit(page, `/company/${id}/sales/customers`);
    await expect(page.locator("table").first()).toBeVisible();
  });
});

persona("P16", "Cost controller", "Uploads vendor bills and studies suppliers", async (run) => {
  const { page, id } = await owner(run, "costs", { expenses: true });
  await tour(run, page, id, EXP, "expense pages");
  await run.step("supplier table", async () => {
    await run.visit(page, `/company/${id}/expenses/suppliers`);
    await expect(page.getByTestId("supplier-table")).toContainText("Philips Healthcare Egypt");
  });
});

persona("P17", "Credit controller", "Uploads ageing reports and payments and checks receivables", async (run) => {
  const { page, id } = await owner(run, "credit", { payments: true });
  await tour(run, page, id, PAY, "payments pages");
  await run.step("headline says what customers owe", async () => {
    await run.visit(page, `/company/${id}/payments`);
    await expect(page.getByTestId("payments-headline")).toContainText("Customers owe EGP 1,490");
  });
});

persona("P18", "Wrong-file uploader", "Drops each file in the wrong upload step", async (run) => {
  const { page, id } = await owner(run, "wrongfile");
  for (const [kind, file] of [["accounts", "odoo-invoice-analysis.xlsx"], ["sales", "odoo-trial-balance.xlsx"], ["expenses", "odoo-aged-receivable.xlsx"], ["payments", "odoo-pl-bs.xlsx"]] as const) {
    await run.step(`${file} in the ${kind} step`, async () => {
      await startUpload(page, id, kind);
      await page.getByTestId("file-input").setInputFiles(fixture(file));
      await page.waitForTimeout(4000);
      const body = await page.locator("main").innerText();
      run.check(/not|wrong|instead|looks like|belongs|another step|can't|cannot|moved/i.test(body), "medium", `${file} dropped on the ${kind} step: no message saying it is the wrong kind of file`, page.url());
    });
  }
});

persona("P19", "Corrupt-file uploader", "Uploads random bytes, an empty CSV and a renamed text file", async (run) => {
  const { page, id } = await owner(run, "corrupt");
  const files = [
    { name: "broken.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: randomBytes(4096) },
    { name: "empty.csv", mimeType: "text/csv", buffer: Buffer.from("") },
    { name: "notes.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("hello, this is not a spreadsheet") },
    { name: "huge-cell.csv", mimeType: "text/csv", buffer: Buffer.from(`Date,Amount\n2026-01-01,${"9".repeat(5000)}\n`) },
  ];
  for (const f of files) {
    for (const kind of ["accounts", "sales"] as const) {
      await run.step(`${f.name} as ${kind}`, async () => {
        await startUpload(page, id, kind);
        await page.getByTestId("file-input").setInputFiles(f);
        await page.waitForTimeout(4000);
        const body = await page.locator("main").innerText();
        run.check(/could not|can't|cannot|not read|empty|no rows|nothing|not a|problem|error|unreadable|damaged/i.test(body), "medium", `${f.name} on the ${kind} step: no clear message that the file can't be read`, page.url());
        run.check(!/Application error|Something went wrong/i.test(body), "high", `${f.name} on the ${kind} step crashed the page`, page.url());
      });
    }
  }
});

persona("P20", "Double uploader", "Uploads the same files twice and expects nothing doubled", async (run) => {
  const { page, id } = await owner(run, "twice", { files: ["odoo-pl-bs.xlsx"], sales: true });
  let before = "";
  await run.step("read the headline", async () => { await run.visit(page, `/company/${id}/summary`); before = await page.getByTestId("headline").innerText(); });
  await run.step("same accounts file again", async () => { await importFiles(page, id, ["odoo-pl-bs.xlsx"]); });
  await run.step("headline unchanged", async () => {
    await run.visit(page, `/company/${id}/summary`);
    run.check((await page.getByTestId("headline").innerText()) === before, "critical", "Uploading the same accounts file twice changed the headline figure");
  });
  await run.step("same sales file again asks first", async () => {
    await startUpload(page, id, "sales");
    await page.getByTestId("file-input").setInputFiles(fixture("odoo-invoice-analysis.xlsx"));
    await page.getByTestId("sales-next").click({ timeout: 20_000 });
    run.check(await page.getByTestId("duplicates").isVisible({ timeout: 5000 }).catch(() => false), "high", "Same sales file uploaded twice: no duplicate warning");
  });
});

persona("P21", "Messy-spreadsheet owner", "Uploads a hand-made sales CSV with header on row 3, totals and blanks", async (run) => {
  const { page, id } = await owner(run, "messy");
  await run.step("preflight cleans it", async () => {
    const csv = "Sales report\nExported by hand\nDate,Invoice,Customer,Untaxed Amount\n2026-09-01,INV/1,Alpha,1000\n,,,\n2026-09-02,INV/2,Beta,500\n2026-09-02,INV/2,Beta,500\nTotal,,,2000\n";
    await startUpload(page, id, "sales");
    await page.getByTestId("file-input").setInputFiles({ name: "messy.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(page.getByTestId("preflight-sheet")).toBeVisible({ timeout: 20_000 });
    const st = await page.getByTestId("preflight-sheet").getAttribute("data-status");
    run.check(st !== "ready", "medium", `Messy CSV (header on row 3, duplicate and total rows) marked "${st}" with no fixes asked`);
  });
});

persona("P22", "Upload abandoner", "Starts an upload, leaves mid-review, comes back", async (run) => {
  const { page, id } = await owner(run, "abandon");
  await run.step("leave during review", async () => {
    await startUpload(page, id, "accounts");
    await page.getByTestId("file-input").setInputFiles(fixture("odoo-pl-bs.xlsx"));
    await expect(page.getByTestId("review")).toBeVisible({ timeout: 20_000 });
    await run.visit(page, `/company/${id}/summary`);
  });
  await run.step("nothing half-saved", async () => {
    const n = sql(`select count(*) from public.account_balances b join public.companies c on c.id=b.company_id where c.id='${id}'`);
    run.check(n === "0", "critical", `Leaving the upload during review saved ${n} balance rows`);
  });
  await run.step("upload again from scratch works", () => importFiles(page, id, ["odoo-pl-bs.xlsx"]));
});

persona("P23", "Double-clicker", "Clicks every save button twice, fast", async (run) => {
  const { page, id } = await owner(run, "dblclick");
  await run.step("double-click Save on an import", async () => {
    await startUpload(page, id);
    await page.getByTestId("file-input").setInputFiles(fixture("odoo-pl-bs.xlsx"));
    await expect(page.getByTestId("review")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("continue-timeline").click();
    await page.getByTestId("commit-import").dblclick();
    await expect(page.getByTestId("done-step")).toBeVisible({ timeout: 45_000 });
    const n = sql(`select count(*) from public.imports where company_id='${id}'`);
    run.check(n === "1", "high", `Double-clicking Save recorded ${n} imports`);
  });
  await run.step("double-click Create report", async () => {
    await run.visit(page, `/company/${id}/reports`);
    await page.getByTestId("create-report").dblclick();
    await page.waitForTimeout(4000);
    const n = sql(`select count(*) from public.reports where company_id='${id}'`);
    run.check(n === "1", "medium", `Double-clicking Create report made ${n} reports`);
  });
  await run.step("double-click Save profile", async () => {
    await run.visit(page, `/company/${id}/settings/profile`);
    await page.getByRole("button", { name: "Save profile" }).dblclick();
    await expect(page.getByText("Saved.")).toBeVisible({ timeout: 10_000 });
  });
});

persona("P24", "Back-button user", "Uses the browser Back button inside the upload wizard", async (run) => {
  const { page, id } = await owner(run, "back");
  await run.step("back from review, then forward again", async () => {
    await startUpload(page, id);
    await page.getByTestId("file-input").setInputFiles(fixture("odoo-pl-bs.xlsx"));
    await expect(page.getByTestId("review")).toBeVisible({ timeout: 20_000 });
    await page.goBack();
    await page.waitForLoadState("networkidle");
    await page.goForward();
    await page.waitForLoadState("networkidle");
    const body = await page.locator("main").innerText();
    run.check(!/Application error|Something went wrong/.test(body), "high", "Back/forward in the upload wizard broke the page");
  });
  await run.step("wizard Back buttons", async () => {
    await startUpload(page, id);
    const back = page.getByTestId("wiz-back");
    if (await back.isVisible()) { await back.click(); await back.click().catch(() => {}); }
    await expect(page.locator("h1")).toBeVisible();
  });
});

// ───────────────────────────── Settings, reports, data management

persona("P25", "Settings tinkerer", "Changes profile, financial year, targets, KPIs and alerts", async (run) => {
  const { page, id } = await owner(run, "settings", { files: ["odoo-pl-bs.xlsx"] });
  await run.step("profile", async () => {
    await run.visit(page, `/company/${id}/settings/profile`);
    await page.getByLabel("Company name").fill("Tinker Co Renamed");
    await page.getByLabel("Industry").fill("Medical");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
  });
  await run.step("company name of 300 characters", async () => {
    await page.getByLabel("Company name").fill("N".repeat(300));
    await page.getByRole("button", { name: "Save profile" }).click();
    await page.waitForTimeout(2000);
    const body = await page.locator("main").innerText();
    run.check(/Saved\.|too long|at most|characters/i.test(body), "medium", "300-character company name: no saved or too-long message");
    await page.getByLabel("Company name").fill("Tinker Co");
    await page.getByRole("button", { name: "Save profile" }).click();
  });
  await run.step("targets, KPIs, alerts", async () => {
    for (const p of ["settings/targets", "settings/kpis", "settings/alerts"]) {
      await run.visit(page, `/company/${id}/${p}`);
      const sw = page.getByRole("switch").first();
      if (await sw.isVisible().catch(() => false)) await sw.click();
      const save = page.getByTestId("save-kpis");
      if (await save.isVisible().catch(() => false)) { await save.click(); await expect(page.getByText(/Saved\./)).toBeVisible({ timeout: 10_000 }); }
    }
  });
  await run.step("negative target value", async () => {
    await run.visit(page, `/company/${id}/settings/targets`);
    const input = page.locator('input[type="number"]').first();
    if (await input.isVisible()) {
      await input.fill("-999999999");
      await page.getByTestId("save-kpis").click();
      await page.waitForTimeout(1500);
      await run.visit(page, `/company/${id}/summary`);
    }
  });
});

persona("P26", "Chart-of-accounts fixer", "Reclassifies accounts and checks the analysis follows", async (run) => {
  const { page, id } = await owner(run, "coa", { files: ["odoo-pl-bs.xlsx"] });
  await run.step("reclassify one account", async () => {
    await run.visit(page, `/company/${id}/settings/chart-of-accounts`);
    const select = page.locator('select[aria-label^="Reclassify"]').first();
    await select.selectOption("other_income");
    await page.getByRole("button", { name: "Save mapping" }).click();
    await expect(page.getByText(/reclassified/)).toBeVisible({ timeout: 15_000 });
  });
  await tour(run, page, id, ["summary", "analysis/profitability", "analysis/financials", "data/checks"], "analysis after the change");
});

persona("P27", "Report maker", "Creates, edits, downloads and deletes a report", async (run) => {
  const { page, id } = await owner(run, "report", { files: ["odoo-pl-bs.xlsx"] });
  await run.step("create and save", async () => {
    await run.visit(page, `/company/${id}/reports`);
    await page.getByTestId("create-report").click();
    await expect(page).toHaveURL(/\/reports\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await page.getByRole("button", { name: "Save", exact: true }).click();
  }, { critical: true });
  await run.step("download PDF", async () => {
    const [d] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), page.getByTestId("download-pdf").click()]);
    const p = await d.path();
    run.check(fs.readFileSync(p!).subarray(0, 5).toString() === "%PDF-", "high", "Downloaded report is not a PDF");
  });
  await run.step("printable view", async () => {
    await page.emulateMedia({ media: "print" });
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.emulateMedia({ media: "screen" });
  });
  await run.step("delete the report", async () => {
    const del = page.getByRole("button", { name: /delete/i }).first();
    await del.click();
    const confirm = page.getByTestId("confirm-button");
    if (await confirm.isVisible({ timeout: 3000 }).catch(() => false)) await confirm.click();
    await page.waitForTimeout(2000);
    const n = sql(`select count(*) from public.reports where company_id='${id}'`);
    run.check(n === "0", "medium", `Report still there after delete (${n})`);
  });
});

persona("P28", "Data clearer", "Clears one module, then checks the pages say 'no data' rather than zero", async (run) => {
  const { page, id } = await owner(run, "clear", { sales: true });
  await run.step("clear Sales", async () => {
    await run.visit(page, `/company/${id}/settings/profile`);
    const zone = page.getByTestId("data-and-deletion");
    await zone.getByRole("button", { name: "Clear" }).first().click();
    await page.getByTestId("clear-sales-dialog").getByTestId("confirm-button").click();
    await expect(page.getByRole("status")).toContainText("ready for a clean upload", { timeout: 20_000 });
  }, { critical: true });
  await run.step("sales pages show the empty state", async () => {
    await run.visit(page, `/company/${id}/sales`);
    run.check(await page.getByTestId("no-sales").isVisible().catch(() => false), "high", "After clearing Sales, the Sales page doesn't show the 'no sales' state");
  });
  await tour(run, page, id, [...SALES, "data", "data/readiness"], "pages after clearing");
});

persona("P29", "Company deleter", "Deletes a company and tries its old links", async (run) => {
  const { page, id } = await owner(run, "delco", { files: ["odoo-pl-bs.xlsx"] });
  await run.step("delete by typing the name", async () => {
    await run.visit(page, `/company/${id}/settings/profile`);
    await page.getByRole("button", { name: "Delete this company" }).click();
    const d = page.getByTestId("delete-company-dialog");
    await d.getByTestId("confirm-input").fill("delco Co");
    await d.getByTestId("confirm-button").click();
    await expect(page).toHaveURL(/\/companies/, { timeout: 20_000 });
  }, { critical: true });
  await run.step("old links are 404", async () => {
    for (const p of ["summary", "sales", "data", "reports"]) {
      const r = await page.goto(`/company/${id}/${p}`);
      run.check(r?.status() === 404, "high", `Deleted company /${p} answered ${r?.status()}`);
    }
  });
  await run.step("rows are gone", async () => {
    run.check(sql(`select count(*) from public.account_balances where company_id='${id}'`) === "0", "critical", "Deleted company left balance rows behind");
  });
});

persona("P30", "Portfolio manager", "Runs three companies and compares them", async (run) => {
  const { page } = await owner(run, "portfolio", { files: ["odoo-pl-bs.xlsx"] });
  await run.step("two more companies", async () => {
    const a = await createCompany(page, "Second Co");
    await importFiles(page, a, ["egypt-odoo-trial-balance.xlsx"]);
    await createCompany(page, "Third Co (empty)");
  });
  await run.step("companies list and dashboard", async () => {
    await run.visit(page, "/companies");
    await run.visit(page, "/dashboard");
  });
  await run.step("company switcher", async () => {
    await page.goto("/companies");
    await page.locator('a[href*="/company/"]').first().click();
    const sw = page.getByTestId("company-switcher");
    if (await sw.isVisible()) { await sw.click(); await page.waitForTimeout(500); }
  });
});

persona("P31", "Period explorer", "Switches month, quarter, year and comparisons on every financial page", async (run) => {
  const { page, id } = await owner(run, "period", { files: ["egypt-odoo-general-ledger.xlsx", "egypt-odoo-trial-balance.xlsx", "egypt-odoo-profit-and-loss.xlsx"] });
  await run.step("every period view", async () => {
    for (const q of ["type=quarter", "type=year", "type=ytd", "cmp=prior", "cmp=ly", "type=quarter&cmp=ly", "type=year&cmp=prior"])
      for (const p of ["summary", "analysis/kpis", "analysis/profitability", "analysis/cashflow"]) await run.visit(page, `/company/${id}/${p}?${q}`);
  });
  await run.step("period picker clicks", async () => {
    await run.visit(page, `/company/${id}/summary`);
    await page.getByTestId("period-type").click();
    await page.getByRole("button", { name: "Quarter", exact: true }).click();
    await expect(page).toHaveURL(/type=quarter/);
  });
});

persona("P32", "Data reviewer", "Walks the Data steps, checks and readiness after a full upload", async (run) => {
  const { page, id } = await owner(run, "review", { files: ["egypt-odoo-general-ledger.xlsx", "egypt-odoo-trial-balance.xlsx", "egypt-odoo-profit-and-loss.xlsx"], payments: true });
  await tour(run, page, id, DATA, "data pages");
  await run.step("Data steps show a status for every step", async () => {
    await run.visit(page, `/company/${id}/data`);
    await expect(page.getByTestId("data-steps")).toBeVisible({ timeout: 20_000 });
    const unchecked = await page.locator('[data-status="unchecked"]').count();
    run.check(unchecked === 0, "medium", `${unchecked} data steps say "couldn't be checked" on a healthy local database`);
  });
  await tour(run, page, id, ["settings/data-health", "settings/data-setup", "settings/source-data"], "old settings URLs redirect");
});

persona("P33", "Stock manager without stock files", "Opens inventory pages before any stock upload", async (run) => {
  const { page, id } = await owner(run, "stock", { files: ["odoo-pl-bs.xlsx"] });
  await tour(run, page, id, INV, "inventory pages");
  await run.step("inventory explains what's missing", async () => {
    await run.visit(page, `/company/${id}/inventory`);
    const body = await page.locator("main").innerText();
    run.check(/upload|no stock|valuation|export/i.test(body), "medium", "Inventory with no stock files doesn't say what to upload");
  });
});

persona("P34", "AI commentary requester", "Asks for AI commentary on the summary", async (run) => {
  const { page, id } = await owner(run, "ai", { files: ["odoo-pl-bs.xlsx"] });
  await run.step("request commentary", async () => {
    await run.visit(page, `/company/${id}/summary`);
    const btn = page.getByRole("button", { name: /commentary|explain|AI|write/i }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      await page.waitForTimeout(6000);
      const body = await page.locator("main").innerText();
      run.check(!/Application error/.test(body), "high", "AI commentary crashed the page");
    } else run.issue("low", "expectation", "No AI commentary button found on the summary page");
  });
  await run.step("commentary API directly", async () => {
    const r = await page.request.post(`/api/companies/${id}/commentary`, { data: { type: "month", end: "2026-09", sections: ["summary"] } });
    run.check(r.status() < 500 || r.status() === 503, "high", `Commentary API returned ${r.status()}`);
  });
});

persona("P35", "Privacy-minded user", "Exports their data, renames themselves, reads the account page", async (run) => {
  const { page, id } = await owner(run, "privacy", { files: ["odoo-pl-bs.xlsx"] });
  await run.step("account page", async () => { await run.visit(page, "/account"); });
  await run.step("company export", async () => {
    const r = await page.request.get(`/api/export/${id}`);
    run.check(r.status() === 200 && (r.headers()["content-type"] ?? "").includes("sheet"), "medium", `Company export: ${r.status()} ${r.headers()["content-type"]}`);
  });
  await run.step("personal data export", async () => {
    await run.visit(page, "/account");
    const btn = page.getByRole("button", { name: /export|download/i }).first();
    if (await btn.isVisible().catch(() => false)) {
      const [d] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), btn.click()]);
      run.check(!!(await d.path()), "medium", "Personal export did not download");
    } else run.issue("low", "expectation", "No personal data export button on /account");
  });
});

// ───────────────────────────── Roles

persona("P36", "Organisation admin", "Invites an editor and a viewer, then changes a role", async (run) => {
  const { page } = await owner(run, "orgadmin");
  const ed = newEmail("ed"), vw = newEmail("vw");
  await invite(run, page, ed, "editor");
  await invite(run, page, vw, "viewer");
  await run.step("invite the same person twice", async () => {
    await page.getByPlaceholder("colleague@firm.com").fill(ed);
    await page.getByRole("button", { name: "Invite a person" }).click();
    await page.waitForTimeout(1500);
    run.check((await page.getByRole("cell", { name: ed }).count()) === 1, "medium", "Inviting the same email twice lists them twice");
  });
  await run.step("invalid email", async () => {
    await page.getByPlaceholder("colleague@firm.com").fill("nope");
    await page.getByRole("button", { name: "Invite a person" }).click();
    await page.waitForTimeout(1000);
    run.check((await page.getByRole("cell", { name: "nope" }).count()) === 0, "medium", "An invalid email was invited");
  });
  await run.step("organisation page", async () => { await run.visit(page, "/admin/organisation"); });
});

persona("P37", "Viewer", "Has view-only access and tries to change things anyway", async (run) => {
  const { page: own, id } = await owner(run, "vowner", { files: ["odoo-pl-bs.xlsx"], sales: true });
  const email = newEmail("viewer");
  await invite(run, own, email, "viewer");
  const page = await run.page({ expect4xx: /./ });
  await run.step("viewer signs up", () => signUp(page, { name: "Vera", org: "Vera Org", email }), { critical: true });
  await tour(run, page, id, [...FIN.slice(0, 4), ...SALES.slice(0, 2), "data", "reports", "settings/profile"], "viewer reads pages");
  await run.step("no edit controls", async () => {
    await run.visit(page, `/company/${id}/reports`);
    run.check((await page.getByTestId("create-report").count()) === 0, "high", "Viewer sees Create report");
    await run.visit(page, `/company/${id}/data/upload`);
    run.check((await page.getByTestId("file-input").count()) === 0, "high", "Viewer sees the upload box");
    await run.visit(page, `/company/${id}/settings/profile`);
    run.check((await page.getByRole("button", { name: "Delete this company" }).count()) === 0, "high", "Viewer sees Delete company");
    run.check((await page.getByRole("button", { name: "Save profile" }).isEnabled().catch(() => false)) === false, "high", "Viewer can press Save profile");
  });
  await run.step("viewer calls the API anyway", async () => {
    const r = await page.request.post(`/api/companies/${id}/commentary`, { data: { type: "month", end: "2026-09", sections: ["summary"] } });
    run.check(r.status() !== 200, "high", `Viewer commentary POST returned ${r.status()}`);
  });
});

persona("P38", "Editor", "Can upload, but should not delete the company or manage people", async (run) => {
  const { page: own, id } = await owner(run, "eowner", { files: ["odoo-pl-bs.xlsx"] });
  const email = newEmail("editor");
  await invite(run, own, email, "editor");
  const page = await run.page({ expect4xx: /./ });
  await run.step("editor signs up", () => signUp(page, { name: "Eddie", org: "Eddie Org", email }), { critical: true });
  await run.step("editor uploads sales", () => uploadSales(page, id));
  await run.step("editor cannot delete or invite", async () => {
    await run.visit(page, `/company/${id}/settings/profile`);
    run.check((await page.getByRole("button", { name: "Delete this company" }).count()) === 0, "high", "Editor sees Delete company");
    await page.goto("/admin/people");
    const canInvite = await page.getByRole("button", { name: "Invite a person" }).isVisible().catch(() => false);
    run.check(!canInvite || /Eddie Org/.test(await page.locator("main").innerText()), "medium", "Editor can invite people into the owner's organisation");
  });
});

persona("P39", "Outsider", "A user from another firm tries to reach a company that isn't theirs", async (run) => {
  const { id } = await owner(run, "victim", { files: ["odoo-pl-bs.xlsx"] });
  const page = await run.page({ expect4xx: /./ });
  await run.step("outsider signs up", () => signUp(page, { name: "Otto", org: "Otto Org", email: newEmail("outsider") }), { critical: true });
  await run.step("every page is 404", async () => {
    for (const p of ["summary", "sales", "data", "reports", "settings/profile"]) {
      const r = await page.goto(`/company/${id}/${p}`);
      run.check(r?.status() === 404, "critical", `Outsider reached /company/:id/${p} (${r?.status()})`);
    }
  });
  await run.step("API and REST refuse", async () => {
    run.check((await page.request.get(`/api/export/${id}`)).status() === 404, "critical", "Outsider could export another company");
    const env = fs.readFileSync(".local-supabase/env", "utf8");
    const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)?.[1], key = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)/)?.[1];
    const cookie = (await page.context().cookies()).find((c) => /auth-token/.test(c.name));
    if (url && key && cookie) {
      let token = "";
      try { const v = decodeURIComponent(cookie.value).replace(/^base64-/, ""); token = JSON.parse(Buffer.from(v, "base64").toString()).access_token; } catch { /* cookie format differs */ }
      if (token) {
        const r = await page.request.post(`${url}/rest/v1/rpc/summary_state`, { headers: { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, data: { p_company: id, p_kind: "sales" } });
        run.check(r.status() >= 400, "critical", `Outsider summary_state over REST returned ${r.status()}`);
        const t = await page.request.get(`${url}/rest/v1/account_balances?company_id=eq.${id}&select=*`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
        run.check((await t.text()).trim() === "[]", "critical", "Outsider read another company's balances over REST");
      }
    }
  });
});

persona("P40", "Removed member", "Loses access while signed in, then keeps clicking", async (run) => {
  const { page: own, id } = await owner(run, "rowner", { files: ["odoo-pl-bs.xlsx"] });
  const email = newEmail("removed");
  await invite(run, own, email, "editor");
  const page = await run.page({ expect4xx: /./ });
  await run.step("member signs up and opens the company", async () => { await signUp(page, { name: "Remy", org: "Remy Org", email }); await run.visit(page, `/company/${id}/summary`); }, { critical: true });
  await run.step("access removed in the database", async () => { sql(`delete from public.memberships where user_id=(select id from auth.users where email='${email}') and org_id=(select org_id from public.companies where id='${id}')`); });
  await run.step("next click is refused", async () => {
    const r = await page.goto(`/company/${id}/sales`);
    run.check(r?.status() === 404, "critical", `Removed member still reaches the company (${r?.status()})`);
  });
});

// ───────────────────────────── Robustness

persona("P41", "Session expirer", "Leaves the tab open, the session expires, then acts", async (run) => {
  const { page, id } = await owner(run, "expire", { files: ["odoo-pl-bs.xlsx"] });
  await run.step("cookies cleared mid-session", async () => {
    await run.visit(page, `/company/${id}/settings/profile`);
    await page.context().clearCookies();
    await page.getByRole("button", { name: "Save profile" }).click();
    await page.waitForTimeout(2500);
    const body = await page.locator("body").innerText();
    run.check(/sign in|signed out|session|log in/i.test(body) || /\/login/.test(page.url()), "medium", "Saving after the session expired gives no 'sign in again' message");
  });
  await run.step("navigating sends to sign-in and back", async () => {
    await page.goto(`/company/${id}/sales`);
    run.check(/\/login/.test(page.url()), "high", `Expired session: /sales did not go to sign-in (${page.url()})`);
    run.check(/next=/.test(page.url()), "low", "Expired session: sign-in page doesn't remember where you were going");
  });
});

persona("P42", "Offline user", "Loses the connection and keeps clicking", async (run) => {
  const { page, id } = await owner(run, "offline", { files: ["odoo-pl-bs.xlsx"] });
  await run.step("go offline and click a link", async () => {
    await run.visit(page, `/company/${id}/summary`);
    await page.context().setOffline(true);
    await page.locator(`a[href*="/company/${id}/analysis"]`).first().click().catch(() => {});
    await page.waitForTimeout(3000);
    await page.getByRole("button", { name: /save|retry/i }).first().click({ timeout: 2000 }).catch(() => {});
    await page.context().setOffline(false);
  });
  await run.step("back online, the app recovers", async () => {
    await run.visit(page, `/company/${id}/summary`);
    await expect(page.getByTestId("headline")).toBeVisible();
  });
});

persona("P43", "Slow-connection user", "Uses the site over a throttled 3G-like connection", async (run) => {
  const { page, id } = await owner(run, "slow", { files: ["odoo-pl-bs.xlsx"], sales: true });
  await run.step("throttle and browse", async () => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 400, downloadThroughput: 200_000, uploadThroughput: 90_000 });
    for (const p of ["summary", "sales", "sales/products", "data", "reports"]) {
      const t0 = Date.now();
      await page.goto(`/company/${id}/${p}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
      const ms = Date.now() - t0;
      const bytes = await page.evaluate(() => performance.getEntriesByType("resource").reduce((s, e) => s + ((e as PerformanceResourceTiming).transferSize || 0), 0));
      run.r.timings.push({ url: `[3G] /company/:id/${p}`, ms });
      run.check(ms < 15_000, "medium", `On a slow connection /${p} took ${(ms / 1000).toFixed(1)} s to show (${Math.round(bytes / 1024)} KB)`);
    }
  });
});

persona("P44", "Two-tab worker", "Uploads in one tab while another tab shows the old figures", async (run) => {
  const { page, id } = await owner(run, "twotab");
  const other = await run.page({ storageState: await page.context().storageState() });
  await run.step("tab B open on sales (empty)", async () => { await run.visit(other, `/company/${id}/sales`); });
  await run.step("tab A uploads sales", () => uploadSales(page, id));
  await run.step("tab B refresh shows the new sales", async () => {
    await other.reload();
    await other.waitForLoadState("networkidle");
    await expect(async () => {
      await other.reload();
      expect(await other.getByTestId("no-sales").count()).toBe(0);
    }).toPass({ timeout: 30_000 });
  });
});

persona("P45", "Busy Monday (load burst)", "Ten colleagues open the same company's heavy pages at once", async (run) => {
  const { page, id } = await owner(run, "burst", { files: ["egypt-odoo-general-ledger.xlsx", "egypt-odoo-trial-balance.xlsx", "egypt-odoo-profit-and-loss.xlsx"], sales: true, expenses: true, payments: true });
  const state = await page.context().storageState();
  await run.step("10 tabs × 4 heavy pages at the same time", async () => {
    const tabs = await Promise.all(Array.from({ length: 10 }, () => run.page({ storageState: state })));
    const t0 = Date.now();
    const res = await Promise.all(tabs.flatMap((t, i) => [async () => {
      for (const p of ["sales", "expenses", "payments", "data"]) {
        const s = Date.now();
        const r = await t.goto(`/company/${id}/${p}`, { timeout: 60_000 }).catch((e) => e as Error);
        run.r.timings.push({ url: `[burst ${i}] /company/:id/${p}`, ms: Date.now() - s });
        if (r instanceof Error) run.issue("high", "burst", `tab ${i} /${p}: ${r.message.split("\n")[0]}`);
        else if ((r?.status() ?? 0) >= 500) run.issue("high", "burst", `tab ${i} /${p}: HTTP ${r?.status()}`);
        else if (await t.getByTestId("module-failed").isVisible().catch(() => false)) run.issue("high", "burst", `tab ${i} /${p}: "couldn't be loaded" shown under load`);
      }
    }].map((f) => f())));
    void res;
    run.check(Date.now() - t0 < 60_000, "medium", `Burst of 40 page loads took ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  });
});

persona("P46", "Tiny-screen user", "Uses a 320-pixel-wide phone", async (run) => {
  const { page, id } = await owner(run, "tiny", { files: ["odoo-pl-bs.xlsx"], sales: true, page: await run.page({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true }) });
  await tour(run, page, id, ["summary", "sales", "sales/products", "analysis/financials", "data", "data/upload", "settings/profile", "reports"], "pages at 320 px");
  await run.step("menu opens and closes", async () => {
    await run.visit(page, `/company/${id}/summary`);
    const menu = page.getByTestId("user-menu");
    await menu.click();
    await page.keyboard.press("Escape");
  });
});

persona("P47", "Dark-mode, reduced-motion user", "Prefers dark colours and no animation", async (run) => {
  const { page, id } = await owner(run, "dark", { files: ["odoo-pl-bs.xlsx"], page: await run.page({ colorScheme: "dark", reducedMotion: "reduce" }) });
  await run.step("text is readable in dark mode", async () => {
    for (const p of ["summary", "analysis/financials", "data", "settings/profile"]) {
      await run.visit(page, `/company/${id}/${p}`);
      const low = await page.evaluate(() => {
        // Any CSS colour (rgb, oklch, color-mix …) read through a 1×1 canvas, so the numbers are always sRGB 0-255.
        const cv = document.createElement("canvas"); cv.width = cv.height = 1; const g = cv.getContext("2d", { willReadFrequently: true })!;
        const rgba = (c: string) => { g.clearRect(0, 0, 1, 1); g.fillStyle = "#000"; g.fillStyle = c; g.fillRect(0, 0, 1, 1); return Array.from(g.getImageData(0, 0, 1, 1).data); };
        const lum = (c: number[]) => { const [r, gg, b] = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * gg + 0.0722 * b; };
        // The background a reader sees: layers above white, each blended by its own alpha.
        const bgOf = (el: Element | null): number[] => {
          const layers: number[][] = [];
          while (el) { const c = rgba(getComputedStyle(el).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] === 255) break; el = el.parentElement; }
          let out = [255, 255, 255];
          for (const c of layers.reverse()) { const a = c[3] / 255; out = out.map((v, i) => v * (1 - a) + c[i] * a); }
          return out;
        };
        let bad = 0; const ex: string[] = [];
        for (const el of Array.from(document.querySelectorAll("main p, main h1, main h2, main td, main span")).slice(0, 400)) {
          if (!(el as HTMLElement).innerText?.trim()) continue;
          const a = lum(rgba(getComputedStyle(el).color)), b = lum(bgOf(el));
          const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          if (ratio < 3) { bad++; if (ex.length < 3) ex.push((el as HTMLElement).innerText.slice(0, 30)); }
        }
        return { bad, ex };
      });
      run.check(low.bad === 0, "low", `Dark mode /${p}: ${low.bad} text elements below 3:1 contrast (e.g. ${low.ex.join(" | ")})`, page.url());
    }
  });
});

persona("P48", "Rapid navigator", "Clicks through tabs faster than pages load", async (run) => {
  const { page, id } = await owner(run, "rapid", { files: ["odoo-pl-bs.xlsx"], sales: true });
  await run.step("ten tab switches without waiting", async () => {
    await run.visit(page, `/company/${id}/summary`);
    for (let i = 0; i < 10; i++) {
      for (const t of ["sales", "expenses", "financials", "banking"]) await page.getByTestId(`tab-${t}`).filter({ visible: true }).first().click({ timeout: 3000, noWaitAfter: true }).catch(() => {});
    }
    await page.waitForLoadState("networkidle");
    await expect(page.locator("h1").first()).toBeVisible();
    const body = await page.locator("body").innerText();
    run.check(!/Application error|Something went wrong/.test(body), "high", "Rapid tab switching ended on an error page");
  });
});

persona("P49", "Odoo live connector tester", "Tries to connect Odoo with bad addresses", async (run) => {
  const { page, id } = await owner(run, "odoo");
  await run.step("Odoo page opens", async () => { await run.visit(page, `/company/${id}/data/odoo`); });
  await run.step("internal address is refused", async () => {
    const url = page.getByLabel(/URL|address/i).first();
    if (!(await url.isVisible().catch(() => false))) { run.issue("low", "expectation", "No Odoo URL field on the Odoo page"); return; }
    await url.fill("http://127.0.0.1:5432");
    await page.getByLabel(/database/i).first().fill("x").catch(() => {});
    await page.getByLabel(/login|user/i).first().fill("x@y.z").catch(() => {});
    await page.getByLabel(/key/i).first().fill("abc").catch(() => {});
    await page.getByRole("button", { name: /test/i }).first().click();
    await page.waitForTimeout(5000);
    const body = await page.locator("main").innerText();
    run.check(/https|not allowed|private|refused|invalid|can't|cannot|failed/i.test(body), "high", "Odoo test against an internal address shows no refusal");
  });
});

persona("P50", "Opening-balances newcomer", "Loads opening balances first, then the ledger", async (run) => {
  const { page, id } = await owner(run, "opening");
  await run.step("opening card accepts a trial balance", async () => {
    await startUpload(page, id, "opening");
    await page.getByTestId("file-input").setInputFiles(fixture("odoo-trial-balance.xlsx"));
    await page.waitForTimeout(5000);
    const body = await page.locator("main").innerText();
    run.check(!/Application error/.test(body), "high", "Opening balances step crashed");
  });
  await run.step("then the ledger", () => importFiles(page, id, ["egypt-odoo-general-ledger.xlsx"]));
  await tour(run, page, id, ["summary", "analysis/financials", "data", "data/checks"], "pages after opening + ledger");
});

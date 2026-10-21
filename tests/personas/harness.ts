import fs from "node:fs";
import path from "node:path";
import { test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { textAndLayout } from "../e2e/crawl-helpers";

/**
 * Persona runs: each persona is a person using the site their own way. Nothing here stops at the first problem; every
 * problem is recorded as an issue (with the step, the page and the evidence) and written to test-results/personas, where
 * scripts/personas/report.mjs gathers them into one Markdown file. Runs only against the local stack, never production.
 */
export type Severity = "critical" | "high" | "medium" | "low";
export interface Issue { severity: Severity; kind: string; message: string; step: string; url: string; evidence?: string }
export interface StepResult { name: string; ok: boolean; ms: number; error?: string }
export interface PersonaResult { id: string; name: string; goal: string; issues: Issue[]; steps: StepResult[]; timings: { url: string; ms: number }[] }

export const OUT = path.join(__dirname, "../../test-results/personas");
const SLOW_MS = 3000, VERY_SLOW_MS = 8000;

export class Run {
  readonly r: PersonaResult;
  private current = "setup";
  private aborted = false;
  pages: Page[] = [];
  constructor(id: string, name: string, goal: string, readonly browser: Browser) { this.r = { id, name, goal, issues: [], steps: [], timings: [] }; }

  issue(severity: Severity, kind: string, message: string, url = "", evidence?: string) {
    this.r.issues.push({ severity, kind, message: message.slice(0, 400), step: this.current, url: url.replace(/^https?:\/\/[^/]+/, ""), evidence });
  }

  /** A browser window watched for everything a person would see go wrong. */
  async page(opts: BrowserContextOptions & { expect4xx?: RegExp } = {}): Promise<Page> {
    const { expect4xx, ...ctxOpts } = opts;
    const ctx = await this.browser.newContext(ctxOpts);
    const page = await ctx.newPage();
    this.watch(page, expect4xx);
    this.pages.push(page);
    return page;
  }

  watch(page: Page, expect4xx?: RegExp) {
    page.on("pageerror", (e) => this.issue("high", "script error", e.message.split("\n")[0], page.url()));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const t = m.text();
      if (/status of (401|403|404)/.test(t) && expect4xx) return;
      if (/Failed to load resource: net::ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED/.test(t)) return;
      this.issue("medium", "console error", t.slice(0, 300), page.url());
    });
    page.on("response", (res) => {
      const u = res.url(), s = res.status();
      if (s < 400 || !/localhost|127\.0\.0\.1/.test(u)) return;
      if (s < 500 && expect4xx?.test(u)) return;
      const nav = res.request().isNavigationRequest();
      this.issue(s >= 500 ? "high" : nav ? "medium" : "low", `HTTP ${s}`, `${res.request().method()} ${u.replace(/^https?:\/\/[^/]+/, "").slice(0, 160)}`, page.url());
    });
    page.on("requestfailed", (req) => {
      const f = req.failure()?.errorText ?? "";
      if (/ERR_ABORTED|ERR_INTERNET_DISCONNECTED|NS_BINDING_ABORTED/.test(f)) return;
      if (!/localhost|127\.0\.0\.1/.test(req.url())) return;
      this.issue("medium", "request failed", `${req.method()} ${req.url().replace(/^https?:\/\/[^/]+/, "").slice(0, 160)}: ${f}`, page.url());
    });
  }

  /** Opens a page, times it, and checks what a reader sees (broken numbers, overflow, no heading). */
  async visit(page: Page, url: string, opts: { status?: number; quiet?: boolean } = {}) {
    const t0 = Date.now();
    const res = await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => this.issue("low", "never idle", "page kept making requests for 20 s", url));
    const ms = Date.now() - t0;
    this.r.timings.push({ url: url.replace(/[0-9a-f-]{36}/g, ":id"), ms });
    const st = res?.status() ?? 0;
    if (st !== (opts.status ?? 200)) this.issue(st >= 500 ? "high" : "medium", "unexpected status", `${url.replace(/[0-9a-f-]{36}/g, ":id")} returned ${st}, expected ${opts.status ?? 200}`, url);
    if (ms > VERY_SLOW_MS) this.issue("high", "very slow page", `${url.replace(/[0-9a-f-]{36}/g, ":id")} took ${(ms / 1000).toFixed(1)} s`, url);
    else if (ms > SLOW_MS) this.issue("medium", "slow page", `${url.replace(/[0-9a-f-]{36}/g, ":id")} took ${(ms / 1000).toFixed(1)} s`, url);
    if (!opts.quiet && st < 400) for (const i of await textAndLayout(page).catch(() => [])) this.issue(/NaN|undefined|Infinity|object Object|null/.test(i) ? "high" : "low", "page content", i, url);
    return res;
  }

  /** One thing the person does. A failure is recorded and, if critical, the rest of the journey is skipped. */
  async step(name: string, fn: () => Promise<void>, opts: { critical?: boolean; severity?: Severity } = {}) {
    if (this.aborted) { this.r.steps.push({ name, ok: false, ms: 0, error: "skipped (an earlier critical step failed)" }); return false; }
    this.current = name;
    const t0 = Date.now();
    try {
      await fn();
      this.r.steps.push({ name, ok: true, ms: Date.now() - t0 });
      return true;
    } catch (e) {
      const msg = (e as Error).message.split("\n").filter((l) => l.trim()).slice(0, 3).join(" | ").replace(/\x1b\[[0-9;]*m/g, "");
      const shot = await this.shot(name);
      this.issue(opts.severity ?? (opts.critical ? "high" : "medium"), "step failed", `${name}: ${msg}`, this.pages.at(-1)?.url() ?? "", shot);
      this.r.steps.push({ name, ok: false, ms: Date.now() - t0, error: msg });
      if (opts.critical) this.aborted = true;
      return false;
    }
  }

  /** A check that records an issue instead of throwing. */
  check(ok: boolean, severity: Severity, message: string, url = "") { if (!ok) this.issue(severity, "expectation", message, url); return ok; }

  private async shot(name: string) {
    const p = this.pages.at(-1);
    if (!p || p.isClosed()) return undefined;
    const file = path.join(OUT, "shots", `${this.r.id}-${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}.png`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    return p.screenshot({ path: file, fullPage: false }).then(() => path.relative(path.join(__dirname, "../.."), file)).catch(() => undefined);
  }

  save() {
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, `${this.r.id}.json`), JSON.stringify(this.r, null, 1));
  }
}

/** Declares one persona. The journey never fails the test run; its problems go to the report. */
export function persona(id: string, name: string, goal: string, journey: (run: Run) => Promise<void>, timeout = 240_000) {
  test(`${id} ${name}`, async ({ browser }) => {
    test.setTimeout(timeout + 30_000);
    const run = new Run(id, name, goal, browser);
    try {
      await Promise.race([journey(run), new Promise((_, rej) => setTimeout(() => rej(new Error(`journey still running after ${timeout / 1000} s`)), timeout))]);
    } catch (e) {
      run.issue("high", "journey crashed", (e as Error).message.split("\n")[0]);
    } finally {
      run.save();
      for (const p of run.pages) await p.context().close().catch(() => {});
    }
  });
}

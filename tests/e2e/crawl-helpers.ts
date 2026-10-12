import { expect, type APIRequestContext, type Page } from "@playwright/test";

/** Text that must never reach a reader: a broken calculation or a template slip. */
const BAD_TEXT = /\bNaN\b|\bundefined\b|\bInfinity\b|\[object Object\]|\bnull\b(?! value)/;

export interface PageIssues { url: string; issues: string[] }

/**
 * Opens a page and collects everything a visitor would see go wrong: script errors, failed requests on our own origin,
 * broken numbers in the text, a page wider than the screen, and a missing heading.
 */
export async function inspect(page: Page, url: string, opts: { expectStatus?: number; allowFailed?: RegExp } = {}): Promise<PageIssues> {
  const issues: string[] = [];
  const origin = new URL(page.url() === "about:blank" ? "http://localhost" : page.url()).origin;
  const onError = (e: Error) => issues.push(`script error: ${e.message.split("\n")[0]}`);
  const onConsole = (m: import("@playwright/test").ConsoleMessage) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // A deliberate 404 page logs its own status; that is checked separately.
    if (/Failed to load resource: the server responded with a status of 404/.test(t) && opts.expectStatus === 404) return;
    issues.push(`console error: ${t.slice(0, 200)}`);
  };
  const onResponse = (r: import("@playwright/test").Response) => {
    const u = r.url();
    if (r.status() < 400 || !u.startsWith(origin) && !u.startsWith("http://localhost")) return;
    if (opts.allowFailed?.test(u)) return;
    if (r.request().isNavigationRequest() && r.status() === opts.expectStatus) return;
    issues.push(`HTTP ${r.status()} ${r.request().method()} ${u.replace(/^https?:\/\/[^/]+/, "")}`);
  };
  page.on("pageerror", onError);
  page.on("console", onConsole);
  page.on("response", onResponse);
  try {
    const res = await page.goto(url);
    const status = res?.status() ?? 0;
    if (status !== (opts.expectStatus ?? 200)) issues.push(`status ${status}, expected ${opts.expectStatus ?? 200}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    issues.push(...(await textAndLayout(page)));
  } finally {
    page.off("pageerror", onError);
    page.off("console", onConsole);
    page.off("response", onResponse);
  }
  return { url, issues };
}

/** Broken values in the visible text, horizontal overflow and a missing page heading. */
export async function textAndLayout(page: Page): Promise<string[]> {
  const issues: string[] = [];
  const text = await page.locator("body").innerText();
  const bad = text.split("\n").filter((l) => BAD_TEXT.test(l));
  if (bad.length) issues.push(`bad text: ${bad.slice(0, 3).map((l) => JSON.stringify(l.slice(0, 90))).join(", ")}`);
  const over = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= w + 1) return null;
    // Name the widest element that is not inside a scrollable box, so the fix is obvious.
    let worst: { tag: string; right: number } | null = null;
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      const r = el.getBoundingClientRect();
      if (r.right <= w + 1 || r.width === 0) continue;
      let p: HTMLElement | null = el.parentElement, clipped = false;
      while (p && p !== document.body) {
        const s = getComputedStyle(p);
        if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) { clipped = true; break; }
        p = p.parentElement;
      }
      if (!clipped && (!worst || r.right > worst.right)) worst = { tag: `${el.tagName.toLowerCase()}${el.dataset.testid ? `[${el.dataset.testid}]` : ""}.${String(el.className).slice(0, 60)}`, right: Math.round(r.right) };
    }
    return { scroll: document.documentElement.scrollWidth, w, worst };
  });
  if (over) issues.push(`page wider than screen: ${over.scroll}px > ${over.w}px${over.worst ? ` (${over.worst.tag} to ${over.worst.right}px)` : ""}`);
  if (!(await page.locator("h1").count())) issues.push("no h1 heading");
  return issues;
}

/** Every same-origin link on the page, without query or hash duplicates. */
export async function internalLinks(page: Page): Promise<string[]> {
  const hrefs = await page.locator("a[href]").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
  const origin = new URL(page.url()).origin;
  return [...new Set(hrefs.filter((h) => h.startsWith(origin)).map((h) => h.split("#")[0]))];
}

/** Links that do not answer (4xx/5xx), checked with the page's own cookies. */
export async function brokenLinks(request: APIRequestContext, links: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const l of links) {
    if (/\/auth\/signout|\/api\/export|\/api\/pdf/.test(l)) continue;
    const r = await request.get(l, { maxRedirects: 5 });
    if (r.status() >= 400) out.push(`${r.status()} ${new URL(l).pathname}${new URL(l).search}`);
  }
  return out;
}

export function expectClean(all: PageIssues[]) {
  const bad = all.filter((p) => p.issues.length);
  expect(bad.map((p) => `${p.url}\n  - ${p.issues.join("\n  - ")}`).join("\n")).toBe("");
}

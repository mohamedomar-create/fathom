import "server-only";
import type { Browser } from "puppeteer-core";

const LOCAL_CHROMIUM = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";

async function launch(): Promise<Browser> {
  const puppeteer = (await import("puppeteer-core")).default;
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const chromium = (await import("@sparticuz/chromium")).default;
    return puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true, defaultViewport: { width: 1240, height: 1754 } });
  }
  return puppeteer.launch({ executablePath: LOCAL_CHROMIUM, headless: true, args: ["--no-sandbox"] });
}

/**
 * Render a self-contained HTML document to an A4 PDF.
 * Loaded with setContent (never a URL), JavaScript disabled and every network request blocked except data: URLs,
 * so untrusted HTML cannot reach the network or run code.
 */
export async function htmlToPdf(html: string, opts: { footer?: string; margins?: boolean } = {}): Promise<Uint8Array> {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (req) => (req.url().startsWith("data:") || req.url() === "about:blank" ? req.continue() : req.abort()));
    await page.emulateMediaType("print");
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
    await page.evaluateHandle("document.fonts.ready").catch(() => undefined);
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    return await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: false,
      margin: opts.margins === false ? { top: "0", bottom: "0", left: "0", right: "0" } : { top: "10mm", bottom: "16mm", left: "0", right: "0" },
      displayHeaderFooter: Boolean(opts.footer),
      headerTemplate: "<span></span>",
      footerTemplate: opts.footer
        ? `<div style="font-size:7.5px;color:#888;width:100%;padding:0 14mm;display:flex;justify-content:space-between;font-family:sans-serif"><span>${esc(opts.footer)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`
        : "<span></span>",
    });
  } finally {
    await browser.close();
  }
}

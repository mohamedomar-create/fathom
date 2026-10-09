import "server-only";
import type { Browser } from "puppeteer-core";

const LOCAL_CHROMIUM = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";

async function launch(): Promise<Browser> {
  const puppeteer = (await import("puppeteer-core")).default;
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const chromium = (await import("@sparticuz/chromium")).default;
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
      defaultViewport: { width: 1240, height: 1754 },
    });
  }
  return puppeteer.launch({ executablePath: LOCAL_CHROMIUM, headless: true, args: ["--no-sandbox"] });
}

/**
 * Render a complete, self-contained HTML document to an A4 PDF.
 * The HTML is loaded with setContent (never a URL) so it works behind Vercel deployment protection.
 */
export async function htmlToPdf(html: string, opts: { footer?: string } = {}): Promise<Uint8Array> {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.emulateMediaType("print");
    await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    return await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "14mm", bottom: "16mm", left: "12mm", right: "12mm" },
      displayHeaderFooter: Boolean(opts.footer),
      headerTemplate: "<span></span>",
      footerTemplate: opts.footer
        ? `<div style="font-size:8px;color:#888;width:100%;padding:0 12mm;display:flex;justify-content:space-between"><span>${opts.footer}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`
        : "<span></span>",
    });
  } finally {
    await browser.close();
  }
}

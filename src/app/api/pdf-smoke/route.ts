import { htmlToPdf } from "@/lib/pdf/render";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Deployment smoke test: proves headless Chromium boots on this host (incl. Arabic glyphs). */
export async function GET() {
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;padding:40px">
    <h1>PDF engine OK</h1><p>Arabic check: المبيعات — تكلفة المبيعات</p><p>${new Date().toISOString()}</p></body></html>`;
  const pdf = await htmlToPdf(html, { footer: "Smoke test" });
  return new Response(Buffer.from(pdf), { headers: { "content-type": "application/pdf", "cache-control": "no-store" } });
}

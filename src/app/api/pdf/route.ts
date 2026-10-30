import { NextResponse } from "next/server";
import { z } from "zod";
import { htmlToPdf } from "@/lib/pdf/render";
import { REPORT_FONT_CSS } from "@/lib/report/fonts.generated";
import { getUser } from "@/lib/supabase/server";
import { clientIp, limited, TOO_MANY } from "@/lib/rate-limit";
import { localLimiter } from "@/lib/local-limit";
import { imageSources, pageBody, printOrigin, sameOriginStyles } from "@/lib/pdf/print-page";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Signed-out renders from one address: 5 in 10 minutes on this server (pdf_render_ip in the database before 0038). */
const ipOver = localLimiter(600_000, 5);

const Body = z.object({
  html: z.string().min(10).max(3_500_000).optional(),
  css: z.string().max(1_500_000).optional(),
  title: z.string().max(200).default("Report"),
  footer: z.string().max(240).optional(),
  token: z.string().min(1).max(100).optional(),
  companyId: z.string().uuid().optional(),
  reportId: z.string().uuid().optional(),
  demo: z.boolean().optional(),
});

/**
 * A report's PDF is printed from the page the server draws from its own data (0043): the link's frozen figures, or a
 * signed-in member's saved report with the company's current figures. A browser's HTML is taken only for the demo, whose
 * figures are made up and not stored.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const b = parsed.data;
  const { supabase, user } = await getUser();
  const ip = clientIp(req);
  let over: boolean;
  let source: { path: string } | { html: string; css: string };
  if (b.demo && b.html) {
    // The demo has one allowance shared by every signed-out visitor, across server instances (0038).
    over = ipOver(ip);
    if (!over) {
      const demo = await supabase.rpc("rate_limit_demo");
      over = demo.error ? true : demo.data === false;
    }
    source = { html: b.html, css: b.css ?? "" };
  } else if (b.token) {
    const { data } = await supabase.rpc("get_published_report", { p_token: b.token });
    if (!data) return NextResponse.json({ error: "Report not found" }, { status: 404 });
    // The link's allowance is counted in the database, only for a real link (0038).
    over = ipOver(ip);
    if (!over) {
      const link = await supabase.rpc("rate_limit_link", { p_token: b.token });
      over = link.error ? true : link.data === false;
    }
    source = { path: `/r/${encodeURIComponent(b.token)}/print` };
  } else if (b.companyId && b.reportId) {
    if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
    over = await limited(supabase, "pdf_render_user", user.id);
    source = { path: `/print/${b.companyId}/${b.reportId}` };
  } else if (user) return NextResponse.json({ error: "Name the report to print." }, { status: 400 });
  else return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  if (over) return NextResponse.json({ error: TOO_MANY }, { status: 429 });
  let html: string, css: string;
  if ("html" in source) ({ html, css } = source);
  else {
    const drawn = await drawnPage(req, source.path);
    if (!drawn) return NextResponse.json({ error: "Report not found" }, { status: 404 });
    ({ html, css } = drawn);
  }
  const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${b.title.replace(/</g, "")}</title>
<style>${REPORT_FONT_CSS}</style><style>${css}</style>
<style>
html[class], html, body { --font-sans: 'Poppins', 'Noto Naskh Arabic', 'Segoe UI', sans-serif !important; font-family: 'Poppins', 'Noto Naskh Arabic', sans-serif !important; }
body { background: #fff !important; margin: 0; }
.report .rpage { box-shadow: none !important; margin: 0 !important; width: auto !important; min-height: 0 !important; padding: 8mm 14mm !important; page-break-after: always; break-after: page; }
.report .rpage:last-child { page-break-after: auto; break-after: auto; }
.report .rcover { padding-top: 10mm !important; }
.report .rcover .h-full { min-height: 255mm !important; }
.no-print { display: none !important; }
.report tr, .report .rcomment, .report svg { break-inside: avoid; page-break-inside: avoid; }
.report .tbl td { padding-top: 4px; padding-bottom: 4px; }
</style></head><body>${html}</body></html>`;
  try {
    const pdf = await htmlToPdf(doc, { footer: b.footer });
    const name = b.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "report";
    return new Response(Buffer.from(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${name}.pdf"`, "cache-control": "no-store" } });
  } catch (e) {
    console.error("PDF render failed", e);
    return NextResponse.json({ error: "Could not render the PDF. Use Print → Save as PDF instead." }, { status: 500 });
  }
}

/** The print page the server draws, fetched with the caller's own session; its stylesheets and storage images inlined. */
async function drawnPage(req: Request, path: string): Promise<{ html: string; css: string } | null> {
  const origin = printOrigin(req.url);
  if (!origin) { console.error("PDF: set APP_ORIGIN to the site's address"); return null; }
  const res = await fetch(origin + path, { headers: { cookie: req.headers.get("cookie") ?? "" }, cache: "no-store", redirect: "manual" });
  if (res.status !== 200) return null;
  const page = await res.text();
  const sheets = await Promise.all(sameOriginStyles(page).slice(0, 12).map((h) => fetch(origin + h, { cache: "no-store" }).then((r) => (r.ok ? r.text() : "")).catch(() => "")));
  // Fonts are embedded separately; the PDF never loads anything from the network.
  const css = sheets.join("\n").replace(/@font-face\s*\{[^}]*\}/g, "");
  let html = pageBody(page);
  const storage = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host : null;
  for (const src of new Set(imageSources(html))) {
    if (src.startsWith("data:")) continue;
    let data: string | null = null;
    try {
      if (storage && new URL(src).host === storage) {
        const r = await fetch(src, { cache: "no-store" });
        if (r.ok) data = `data:${r.headers.get("content-type") ?? "image/png"};base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}`;
      }
    } catch { /* left out */ }
    html = html.split(`src="${src}"`).join(data ? `src="${data}"` : `src="" data-removed=""`);
  }
  return { html, css };
}

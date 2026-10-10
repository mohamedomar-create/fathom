import { NextResponse } from "next/server";
import { z } from "zod";
import { htmlToPdf } from "@/lib/pdf/render";
import { REPORT_FONT_CSS } from "@/lib/report/fonts.generated";
import { getUser } from "@/lib/supabase/server";
import { clientIp, limited, TOO_MANY } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  html: z.string().min(10).max(3_500_000),
  css: z.string().max(1_500_000),
  title: z.string().max(200).default("Report"),
  footer: z.string().max(240).optional(),
  token: z.string().max(100).optional(),
  demo: z.boolean().optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const b = parsed.data;
  const { supabase, user } = await getUser();
  const ip = clientIp(req);
  // Who may render: a signed-in user, a valid public report link, or the demo report. Each is limited across instances.
  let over: boolean;
  if (user) over = await limited(supabase, `pdf:user:${user.id}`, 3600, 30);
  else if (b.token) {
    const { data } = await supabase.rpc("get_published_report", { p_token: b.token });
    if (!data) return NextResponse.json({ error: "Report not found" }, { status: 404 });
    over = (await limited(supabase, `pdf:ip:${ip}`, 600, 5)) || (await limited(supabase, `pdf:token:${b.token.slice(0, 16)}`, 3600, 20));
  } else if (b.demo) over = await limited(supabase, `pdf:ip:${ip}`, 600, 5);
  else return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  if (over) return NextResponse.json({ error: TOO_MANY }, { status: 429 });
  const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${b.title.replace(/</g, "")}</title>
<style>${REPORT_FONT_CSS}</style><style>${b.css}</style>
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
</style></head><body>${b.html}</body></html>`;
  try {
    const pdf = await htmlToPdf(doc, { footer: b.footer });
    const name = b.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "report";
    return new Response(Buffer.from(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${name}.pdf"`, "cache-control": "no-store" } });
  } catch (e) {
    console.error("PDF render failed", e);
    return NextResponse.json({ error: "Could not render the PDF. Use Print → Save as PDF instead." }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { aiBudgetOk, OVER_BUDGET, recordAiUsage, type Usage } from "@/lib/ai/budget";
import { z } from "zod";
import { PDFDocument } from "pdf-lib";
import { getUser } from "@/lib/supabase/server";
import { BUSY, limits } from "@/lib/rate-limit";
import { ReadError, readPage } from "@/lib/ai/read-page";
import { MAX_PAGE_BYTES } from "@/lib/ingest/pdf-schema";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Reads one page of a PDF (or a scanned image) for the upload wizard. The page is sent to Claude to be read and is not stored. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_PAGE_BYTES + 100_000) return NextResponse.json({ error: "This page is too large to send. Scan it at a lower resolution." }, { status: 413 });
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const { data: company } = await supabase.from("companies").select("org_id").eq("id", id).maybeSingle();
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: mem } = await supabase.from("memberships").select("role").eq("org_id", company.org_id).eq("user_id", user.id).maybeSingle();
  if (!mem || mem.role === "viewer") return NextResponse.json({ error: "View-only access" }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("page");
  if (!(file instanceof Blob) || !file.size) return NextResponse.json({ error: "No page was sent" }, { status: 400 });
  if (file.size > MAX_PAGE_BYTES) return NextResponse.json({ error: "This page is too large to send. Scan it at a lower resolution." }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!isPdf && !isJpeg) return NextResponse.json({ error: "Send a PDF page or a JPEG image" }, { status: 400 });
  // Each request is one page, so the daily limits below count pages.
  if (isPdf) {
    const pages = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }).then((d) => d.getPageCount()).catch(() => 0);
    if (pages !== 1) return NextResponse.json({ error: "Send one page at a time" }, { status: 400 });
  }
  let asked: unknown = [];
  try { asked = JSON.parse(String(form?.get("check") ?? "[]")); } catch { /* answered below */ }
  const check = z.array(z.string().max(300)).max(20).safeParse(asked);
  if (!check.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  // Reading costs money: 200 pages a day per company and 400 a day per person.
  const limit = await limits(supabase, [["pdf_read_company", id], ["pdf_read_user", user.id]]);
  if (limit === "error") return NextResponse.json({ error: BUSY }, { status: 503 });
  if (limit === "over") return NextResponse.json({ error: "The daily limit for reading PDF pages has been reached. Try again tomorrow, or export the report from Odoo as Excel." }, { status: 429 });
  if (!(await aiBudgetOk(supabase, company.org_id))) return NextResponse.json({ error: OVER_BUDGET }, { status: 429 });

  let used: Usage | null = null;
  try {
    const read = await readPage({ data: Buffer.from(bytes).toString("base64"), type: isPdf ? "pdf" : "jpeg" }, check.data, (u) => { used = u; });
    return NextResponse.json({ read });
  } catch (e) {
    if (e instanceof ReadError) return NextResponse.json({ error: e.message }, { status: 502 });
    console.error("page read failed", e);
    return NextResponse.json({ error: "The page could not be read" }, { status: 500 });
  } finally {
    await recordAiUsage(supabase, company.org_id, "read_page", used);
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { buildTemplate } from "@/lib/templates/build";
import { TEMPLATE_KINDS, type TemplateKind } from "@/lib/templates/spec";
import { BS_KEYS, PL_KEYS } from "@/lib/engine";

export const runtime = "nodejs";

const Q = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  fy: z.coerce.number().int().min(1).max(12).default(1),
  currency: z.string().regex(/^[A-Z]{3}$/).default("EGP"),
  company: z.string().max(80).optional(),
});

/** The blank template for one kind of data, for the company's financial year (no data in it, so no sign-in needed). */
export async function GET(req: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  if (!(TEMPLATE_KINDS as string[]).includes(kind)) return NextResponse.json({ error: "Unknown template" }, { status: 404 });
  const q = Q.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const now = new Date();
  // The financial year that holds this month, unless one is asked for.
  const year = q.data.year ?? (now.getMonth() + 1 >= q.data.fy ? now.getFullYear() : now.getFullYear() - 1);
  const company = q.data.company?.replace(/[^\p{L}\p{N} .&()-]/gu, "").trim() || undefined;
  const buf = await buildTemplate(kind as TemplateKind, { year, fyStart: q.data.fy, currency: q.data.currency, company });
  const file = `ireport-${kind}-template${kind === "financials" ? `-${year}` : ""}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${file}"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}

const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Rows = (keys: readonly string[]) => z.object({
  months: z.array(Period).min(1).max(60),
  rows: z.array(z.object({ code: z.string().max(40), name: z.string().min(1).max(300), cls: z.enum(keys as [string, ...string[]]), values: z.record(Period, z.number().finite()) })).max(3000),
});
const Fill = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/).default("EGP"),
  company: z.string().max(80).optional(),
  fy: z.number().int().min(1).max(12).default(1),
  pl: Rows(PL_KEYS).optional(),
  bs: Rows(BS_KEYS).optional(),
});

/**
 * The financials template filled with the figures iReport read and sorted from an upload, so the next upload can be this
 * one clean file. Nothing is stored: the figures come from the person's browser and go straight back as the file.
 */
export async function POST(req: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  if (kind !== "financials") return NextResponse.json({ error: "Only the financials template can be filled here" }, { status: 404 });
  if (Number(req.headers.get("content-length") ?? 0) > 4_000_000) return NextResponse.json({ error: "Too large" }, { status: 413 });
  const body = Fill.safeParse(await req.json().catch(() => null));
  if (!body.success || (!body.data.pl && !body.data.bs)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const d = body.data;
  const first = (d.pl?.months ?? d.bs!.months)[0];
  const company = d.company?.replace(/[^\p{L}\p{N} .&()-]/gu, "").trim() || undefined;
  const fill = { pl: d.pl as never, bs: d.bs as never };
  const buf = await buildTemplate("financials", { year: Number(first.slice(0, 4)), fyStart: d.fy, currency: d.currency, company, fill });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="ireport-financials-filled.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

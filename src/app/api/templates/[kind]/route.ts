import { NextResponse } from "next/server";
import { z } from "zod";
import { buildTemplate } from "@/lib/templates/build";
import { TEMPLATE_KINDS, type TemplateKind } from "@/lib/templates/spec";

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

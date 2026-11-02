import { NextResponse } from "next/server";
import { z } from "zod";
import { dbError } from "@/lib/action-error";
import { loadExportMeta, readLinePage } from "@/lib/export/parts";
import { limited, TOO_MANY } from "@/lib/rate-limit";
import { getUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const Q = z.object({ what: z.enum(["meta", "sales", "expenses"]), after: z.coerce.number().int().min(0).default(0) });

/**
 * The company export in parts, for the page that builds the workbook: first everything but the lines ("meta"), then the
 * sales and expense lines a page at a time. Each part is one quick request, so no export is cut off by a time limit.
 * Members only (row security decides what comes back); the rate limit counts one export, at its first part.
 */
export async function GET(req: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  if (!z.string().uuid().safeParse(companyId).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const q = Q.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  try {
    if (q.data.what === "meta") {
      if (await limited(supabase, "export", user.id)) return NextResponse.json({ error: TOO_MANY }, { status: 429 });
      const meta = await loadExportMeta(supabase, companyId);
      if (!meta) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json(meta, { headers: { "Cache-Control": "private, no-store" } });
    }
    const page = await readLinePage(supabase, q.data.what === "sales" ? "sales_lines" : "expense_lines", companyId, q.data.after);
    return NextResponse.json(page, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return NextResponse.json({ error: dbError(e as { message: string }, `export:${q.data.what}`) }, { status: 500 });
  }
}

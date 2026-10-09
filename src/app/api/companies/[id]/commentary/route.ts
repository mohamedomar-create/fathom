import { NextResponse } from "next/server";
import { z } from "zod";
import { analyze } from "@/lib/engine";
import { buildContext } from "@/lib/ai/context";
import { COMMENTARY_SECTIONS, CommentaryError, writeCommentary } from "@/lib/ai/commentary";
import { loadCompanyBundle } from "@/lib/company/load";
import { getUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  type: z.enum(["month", "quarter", "year"]),
  end: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  sections: z.array(z.enum(COMMENTARY_SECTIONS)).min(1).optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const bundle = await loadCompanyBundle(id);
  if (bundle.role === "viewer") return NextResponse.json({ error: "View-only access" }, { status: 403 });
  const { data: row } = await supabase.from("companies").select("industry, ai_context").eq("id", id).single();
  try {
    const a = analyze(bundle.months, { type: parsed.data.type, end: parsed.data.end }, bundle.settings, { alerts: bundle.alerts });
    const context = buildContext(a, bundle.months, { name: bundle.name, currency: bundle.settings.currency, industry: row?.industry, aiContext: (row?.ai_context ?? {}) as Record<string, string>, notes: bundle.notes });
    const out = await writeCommentary(context, parsed.data.sections);
    const periodKey = `${parsed.data.type}:${parsed.data.end}`;
    const rows = Object.entries(out).map(([section, body]) => ({ company_id: id, period_key: periodKey, section, body: body!, source: "ai", updated_by: user.id, updated_at: new Date().toISOString() }));
    if (rows.length) {
      const { error } = await supabase.from("commentary").upsert(rows, { onConflict: "company_id,period_key,section" });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ commentary: out });
  } catch (e) {
    if (e instanceof CommentaryError) return NextResponse.json({ error: e.message }, { status: 502 });
    console.error(e);
    return NextResponse.json({ error: "Could not write commentary" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { analyze, stampMemo } from "@/lib/engine";
import { buildContext, linesContext } from "@/lib/ai/context";
import { loadSales } from "@/lib/company/sales-load";
import { loadExpenses } from "@/lib/company/expenses-load";
import { COMMENTARY_SECTIONS, CommentaryError, commentaryStatus, writeCommentary } from "@/lib/ai/commentary";
import { loadCompanyBundle } from "@/lib/company/load";
import { getUser } from "@/lib/supabase/server";
import { dbError } from "@/lib/action-error";
import { BUSY, limits } from "@/lib/rate-limit";
import { aiBudgetOk, OVER_BUDGET, recordAiUsage, type Usage } from "@/lib/ai/budget";

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
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const bundle = await loadCompanyBundle(id);
  if (bundle.role === "viewer") return NextResponse.json({ error: "View-only access" }, { status: 403 });
  // AI calls cost money: 20 a day per company and 60 a day per person.
  const limit = await limits(supabase, [["ai_company", id], ["ai_user", user.id]]);
  if (limit === "error") return NextResponse.json({ error: BUSY }, { status: 503 });
  if (limit === "over") return NextResponse.json({ error: "The daily limit for AI commentary has been reached. Try again tomorrow, or write the commentary by hand." }, { status: 429 });
  const { data: row } = await supabase.from("companies").select("industry, ai_context, org_id").eq("id", id).single();
  // And a monthly allowance per organisation, counted from what each call really used.
  if (!row || !(await aiBudgetOk(supabase, row.org_id))) return NextResponse.json({ error: OVER_BUDGET }, { status: 429 });
  let used: Usage | null = null;
  try {
    const a = analyze(bundle.months, { type: parsed.data.type, end: parsed.data.end }, bundle.settings, { alerts: bundle.alerts });
    const sel = { type: parsed.data.type, end: parsed.data.end };
    const [salesState, expensesState] = await Promise.all([loadSales(id), loadExpenses(id)]);
    // Commentary written from figures that could not be read would describe zeros: refuse, so the person can retry.
    if (salesState.status === "failed" || expensesState.status === "failed")
      return NextResponse.json({ error: `Sales or expense figures couldn't be read just now (ref ${salesState.ref ?? expensesState.ref}). Please try again in a moment.` }, { status: 503 });
    const sales = salesState.data, expenses = expensesState.data;
    const context = {
      ...buildContext(a, bundle.months, { name: bundle.name, currency: bundle.settings.currency, asOf: bundle.asOf ?? null, industry: row?.industry, aiContext: (row?.ai_context ?? {}) as Record<string, string>, notes: bundle.notes, assumptions: bundle.assumptions, accounts: bundle.accounts }, parsed.data.sections),
      // Customers, products and suppliers from the same data, so the commentary can name them.
      ...linesContext(bundle.months, bundle.accounts, sales, expenses, sel, bundle.settings.fyStartMonth, bundle.settings.currency),
    };
    const out = await writeCommentary(context, parsed.data.sections, (u) => { used = u; });
    const periodKey = `${parsed.data.type}:${parsed.data.end}`;
    const rows = Object.entries(out).map(([section, body]) => ({ company_id: id, period_key: periodKey, section, body: section === "bank" || section === "realprofit" ? stampMemo(body!, section, bundle.assumptions ?? {}) : body!, source: "ai", updated_by: user.id, updated_at: new Date().toISOString() }));
    if (rows.length) {
      const { error } = await supabase.from("commentary").upsert(rows, { onConflict: "company_id,period_key,section" });
      if (error) return NextResponse.json({ error: dbError(error, "commentary") }, { status: 500 });
    }
    return NextResponse.json({ commentary: out });
  } catch (e) {
    if (e instanceof CommentaryError) return NextResponse.json({ error: e.message }, { status: commentaryStatus(e) });
    console.error(e);
    return NextResponse.json({ error: "Could not write commentary" }, { status: 500 });
  } finally {
    await recordAiUsage(supabase, row.org_id, "commentary", used);
  }
}

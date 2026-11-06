import { NextResponse } from "next/server";
import { z } from "zod";
import { aiBudgetOk, OVER_BUDGET, recordAiUsage, type Usage } from "@/lib/ai/budget";
import { getUser } from "@/lib/supabase/server";
import { BUSY, limits } from "@/lib/rate-limit";
import { companyRole } from "@/lib/company/role";
import { suggestModule, UnderstandError } from "@/lib/ai/understand";

export const runtime = "nodejs";
export const maxDuration = 45;

// A sample, never the file: the headings and up to 20 data rows (plus up to 10 rows above them), 30 columns, short cells.
const Sample = z.object({
  sheet: z.string().max(100),
  title: z.string().max(200).nullable(),
  rows: z.array(z.array(z.string().max(60).nullable()).max(30)).max(30),
  totalRows: z.number().int().min(0).max(10_000_000),
});

/** AI assist for the intake: which module a table belongs to, from a sample. The answer is a suggestion the person confirms. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (Number(req.headers.get("content-length") ?? 0) > 64_000) return NextResponse.json({ error: "Send a sample of the table, not the file." }, { status: 413 });
  const raw = await req.text().catch(() => "");
  if (raw.length > 64_000) return NextResponse.json({ error: "Send a sample of the table, not the file." }, { status: 413 });
  let body: unknown = null;
  try { body = JSON.parse(raw); } catch { /* answered below */ }
  const parsed = z.object({ sample: Sample }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Send a sample of the table (at most 30 rows and 30 columns)." }, { status: 400 });
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const [role, { data: company }] = await Promise.all([companyRole(supabase, id), supabase.from("companies").select("org_id").eq("id", id).maybeSingle()]);
  if (!role || !company) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (role === "viewer") return NextResponse.json({ error: "View-only access" }, { status: 403 });
  // Each request is one table: 300 a day per company, 500 a day per person.
  const limit = await limits(supabase, [["intake_ai_company", id], ["intake_ai_user", user.id]]);
  if (limit === "error") return NextResponse.json({ error: BUSY }, { status: 503 });
  if (limit === "over") return NextResponse.json({ error: "The daily limit for AI assist has been reached. Choose the module for this table yourself." }, { status: 429 });
  if (!(await aiBudgetOk(supabase, company.org_id))) return NextResponse.json({ error: OVER_BUDGET }, { status: 429 });
  let used: Usage | null = null;
  try {
    const suggestion = await suggestModule(parsed.data.sample, (u) => { used = u; });
    return NextResponse.json({ suggestion });
  } catch (e) {
    if (e instanceof UnderstandError) return NextResponse.json({ error: e.message }, { status: 502 });
    console.error("understand failed", e);
    return NextResponse.json({ error: "AI assist failed. Choose the module yourself." }, { status: 500 });
  } finally {
    await recordAiUsage(supabase, company.org_id, "understand", used);
  }
}

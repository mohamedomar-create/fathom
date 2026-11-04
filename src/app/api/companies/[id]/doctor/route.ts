import { NextResponse } from "next/server";
import { z } from "zod";
import { analyze, money } from "@/lib/engine";
import { buildContext, linesContext } from "@/lib/ai/context";
import { loadSales } from "@/lib/company/sales-load";
import { loadExpenses } from "@/lib/company/expenses-load";
import { loadCompanyBundle } from "@/lib/company/load";
import { getUser } from "@/lib/supabase/server";
import { BUSY, limits } from "@/lib/rate-limit";
import { aiBudgetOk, OVER_BUDGET, recordAiUsage, type Usage } from "@/lib/ai/budget";
import { getLang } from "@/lib/i18n/server";
import { doctorData } from "@/lib/doctor/load";
import { DoctorAiError, doctorAiStatus, verifiedAnswer } from "@/lib/doctor/ai";
import { doctorAiLimits, mayUseDoctorAi } from "@/lib/doctor/access";

export const runtime = "nodejs";
export const maxDuration = 60;

const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Body = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("explain"), key: z.string().min(1).max(400), lang: z.enum(["en", "ar"]).optional() }),
  z.object({ mode: z.literal("ask"), question: z.string().trim().min(3).max(500), end: Month.optional(), lang: z.enum(["en", "ar"]).optional() }),
]);

/** The core statements only: the bank and real-profit blocks are large and not needed to answer about the books. */
const SECTIONS = ["summary", "kpis", "profitability", "cashflow", "pl", "bs", "trend", "growth"] as const;

/** "Explain" a doctor finding, or "Ask your numbers": editors and admins (it spends the AI allowance); the answer's figures are checked before it is sent. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const started = Date.now();
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const bundle = await loadCompanyBundle(id);
  const body = parsed.data;
  if (!mayUseDoctorAi(bundle.role)) return NextResponse.json({ error: "View-only access" }, { status: 403 });
  const limit = await limits(supabase, doctorAiLimits(body.mode, user.id, id));
  if (limit === "error") return NextResponse.json({ error: BUSY }, { status: 503 });
  if (limit === "over") return NextResponse.json({ error: "The limit for AI answers has been reached. Try again later." }, { status: 429 });
  if (!(await aiBudgetOk(supabase, bundle.orgId))) return NextResponse.json({ error: OVER_BUDGET }, { status: 429 });
  const lang = body.lang ?? (await getLang());
  const used: Usage[] = [];
  try {
    const periods = bundle.months.filter((m) => Object.keys(m.pl).length).map((m) => m.period);
    let task: string, end: string | undefined, extra: Record<string, unknown> = {};
    if (body.mode === "explain") {
      const expenses = await loadExpenses(id);
      const flags = expenses.status === "ready" || expenses.status === "stale" ? expenses.data.flags : null;
      const f = doctorData(bundle, { flags, decisions: [] }).findings.find((x) => x.key === body.key);
      if (!f) return NextResponse.json({ error: "That finding is no longer in the list. Reload the page." }, { status: 404 });
      end = f.period && periods.includes(f.period) ? f.period : periods.at(-1);
      task = "Explain this finding to the owner: what it means, the likely cause, and the first thing to check. Then say what happens if it is left alone.";
      extra = { finding: { title: f.title, detail: f.detail, period: f.period ?? null, severity: f.severity, amount_at_stake: f.impact === null ? null : money(f.impact, bundle.settings.currency), basis: f.basis } };
    } else {
      end = body.end && periods.includes(body.end) ? body.end : periods.at(-1);
      task = `Answer the owner's question from the company data. If the data does not answer it, say so and name what is missing.\n\nQuestion: ${body.question}`;
    }
    if (!end) return NextResponse.json({ error: "There are no figures to answer from yet. Upload the books first." }, { status: 409 });
    const sel = { type: "month" as const, end };
    const a = analyze(bundle.months, sel, bundle.settings, { alerts: bundle.alerts, asOf: bundle.asOf });
    const context: Record<string, unknown> = { ...extra, ...buildContext(a, bundle.months, { name: bundle.name, currency: bundle.settings.currency, asOf: bundle.asOf ?? null, notes: bundle.notes, assumptions: bundle.assumptions, accounts: bundle.accounts }, SECTIONS) };
    if (body.mode === "ask") {
      const [sales, expenses] = await Promise.all([loadSales(id), loadExpenses(id)]);
      const usable = (st: string) => st === "ready" || st === "stale";
      if (usable(sales.status) && usable(expenses.status)) Object.assign(context, linesContext(bundle.months, bundle.accounts, sales.data, expenses.data, sel, bundle.settings.fyStartMonth, bundle.settings.currency, bundle.asOf));
    }
    const r = await verifiedAnswer({ task, context, lang, onUsage: (u) => used.push(u), deadline: started + 55_000 });
    return NextResponse.json({ answer: r.text, period: end, verified: true });
  } catch (e) {
    if (e instanceof DoctorAiError) return NextResponse.json({ error: e.message }, { status: doctorAiStatus(e) });
    console.error(e);
    return NextResponse.json({ error: "Could not answer just now" }, { status: 500 });
  } finally {
    for (const u of used) await recordAiUsage(supabase, bundle.orgId, body.mode === "ask" ? "ask" : "doctor", u);
  }
}

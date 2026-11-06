import { NextResponse } from "next/server";
import { z } from "zod";
import { localLimiter } from "@/lib/local-limit";
import { clientIp } from "@/lib/rate-limit";
import { getLang } from "@/lib/i18n/server";
import { getUser } from "@/lib/supabase/server";
import { moduleByKey } from "@/lib/modules/registry";
import { specToDef, type ModuleSpec } from "@/lib/modules/spec";
import { buildModuleTemplate } from "@/lib/modules/template-xlsx";
import type { ModuleDef } from "@/lib/modules/types";

export const runtime = "nodejs";

/** A module's blank template: no data in it, so a catalog module's needs no sign-in (60 in 10 minutes from one address). */
const over = localLimiter(600_000, 60);
const Q = z.object({ company: z.string().uuid().optional(), lang: z.enum(["en", "ar"]).optional() });
const KEY = /^[a-z][a-z0-9_]{1,39}$/;

export async function GET(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  if (!KEY.test(key)) return NextResponse.json({ error: "Unknown module" }, { status: 404 });
  if (over(clientIp(req))) return NextResponse.json({ error: "Too many downloads; try again in a few minutes." }, { status: 429 });
  const q = Q.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  let m: ModuleDef | null = key.startsWith("c_") ? null : moduleByKey(key);
  // A module the company built: its definition is the company's, so only its members get the template.
  if (key.startsWith("c_")) {
    if (!q.data.company) return NextResponse.json({ error: "Unknown module" }, { status: 404 });
    const { supabase, user } = await getUser();
    if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
    const { data } = await supabase.from("company_modules").select("spec").eq("company_id", q.data.company).eq("key", key).eq("kind", "custom").maybeSingle();
    try { m = data?.spec ? specToDef({ ...(data.spec as ModuleSpec), key }) : null; } catch { m = null; }
  }
  if (!m || m.storage !== "generic") return NextResponse.json({ error: "Unknown module" }, { status: 404 });
  const lang = q.data.lang ?? (await getLang());
  const buf = await buildModuleTemplate(m, { lang });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="ireport-${key}-template.xlsx"`,
      "Cache-Control": key.startsWith("c_") ? "private, no-store" : "public, max-age=3600",
    },
  });
}

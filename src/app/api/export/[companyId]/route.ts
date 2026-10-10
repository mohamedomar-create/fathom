import { NextResponse } from "next/server";
import { z } from "zod";
import { dbError } from "@/lib/action-error";
import { attachment, companySheets, slug, toXlsx, type CompanyExport } from "@/lib/export/company-workbook";
import { limited, TOO_MANY } from "@/lib/rate-limit";
import { getUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Every member of the company's organisation may download its data; RLS decides what the query returns. */
export async function GET(_req: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  if (!z.string().uuid().safeParse(companyId).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  if (await limited(supabase, `export:user:${user.id}`, 3600, 20)) return NextResponse.json({ error: TOO_MANY }, { status: 429 });

  const { data: c, error } = await supabase.from("companies").select("*").eq("id", companyId).maybeSingle();
  if (error) return NextResponse.json({ error: dbError(error, "export:company") }, { status: 500 });
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [org, accts, imports, commentary, reports, odoo] = await Promise.all([
    supabase.from("organizations").select("name").eq("id", c.org_id).maybeSingle(),
    supabase.from("source_accounts").select("id, code, name, statement, class").eq("company_id", c.id).eq("version", c.data_version).order("sort_order"),
    supabase.from("imports").select("created_at, action, kind, filename, status, data_version").eq("company_id", c.id).order("created_at"),
    supabase.from("commentary").select("period_key, section, source, updated_at, body").eq("company_id", c.id).order("period_key"),
    supabase.from("reports").select("title, period_type, period_end, status, share_token, expires_at, published_at, created_at").eq("company_id", c.id).order("created_at"),
    // Never the encrypted API key: only the columns listed here leave the database.
    supabase.from("odoo_connections").select("url, db, login, odoo_company_name, months_history, status, last_sync_at").eq("company_id", c.id).maybeSingle(),
  ]);
  const failed = [org, accts, imports, commentary, reports].find((r) => r.error)?.error;
  if (failed) return NextResponse.json({ error: dbError(failed, "export:company") }, { status: 500 });

  const amounts = new Map<string, Record<string, number>>((accts.data ?? []).map((a) => [a.id, {}]));
  for (let from = 0; ; from += 1000) {
    const { data: bal, error: e2 } = await supabase.from("account_balances")
      .select("account_id, period, amount, source_accounts!inner(version)")
      .eq("company_id", c.id).eq("source_accounts.version", c.data_version)
      .order("account_id").order("period").range(from, from + 999);
    if (e2) return NextResponse.json({ error: dbError(e2, "export:balances") }, { status: 500 });
    for (const b of bal ?? []) { const r = amounts.get(b.account_id); if (r) r[b.period] = Number(b.amount); }
    if (!bal || bal.length < 1000) break;
  }

  const exportedAt = new Date().toISOString();
  const data: CompanyExport = {
    exportedAt,
    orgName: org.data?.name ?? "",
    company: c,
    accounts: (accts.data ?? []).map((a) => ({ code: a.code, name: a.name, statement: a.statement, class: a.class, amounts: amounts.get(a.id) ?? {} })),
    imports: imports.data ?? [],
    commentary: commentary.data ?? [],
    reports: (reports.data ?? []).map(({ share_token, ...r }) => ({ ...r, shared: !!share_token })),
    odoo: odoo.data ?? null, // viewers cannot read the connection (RLS) and simply get no sheet
  };
  const file = await toXlsx(companySheets(data));
  return new NextResponse(Buffer.from(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": attachment(`${slug(c.name)}-data-${exportedAt.slice(0, 10)}.xlsx`),
      "Cache-Control": "private, no-store",
    },
  });
}

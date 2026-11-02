import { NextResponse } from "next/server";
import { z } from "zod";
import { dbError } from "@/lib/action-error";
import { attachment, companySheets, slug, toXlsx, type CompanyExport } from "@/lib/export/company-workbook";
import { loadExportMeta, readAllLines } from "@/lib/export/parts";
import { getLang } from "@/lib/i18n/server";
import { limited, TOO_MANY } from "@/lib/rate-limit";
import { getUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The whole company as one workbook, in one request. The page builds the same file from parts (./part) with progress;
 * this address stays for links and scripts. Every member may download; row security decides what the queries return.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  if (!z.string().uuid().safeParse(companyId).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  if (await limited(supabase, "export", user.id)) return NextResponse.json({ error: TOO_MANY }, { status: 429 });
  let data: CompanyExport;
  try {
    const meta = await loadExportMeta(supabase, companyId);
    if (!meta) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const [sales, expenses] = await Promise.all([readAllLines(supabase, "sales_lines", companyId), readAllLines(supabase, "expense_lines", companyId)]);
    data = { ...meta, sales: sales as unknown as CompanyExport["sales"], expenses: expenses as unknown as CompanyExport["expenses"] };
  } catch (e) {
    return NextResponse.json({ error: dbError(e as { message: string }, "export:company") }, { status: 500 });
  }
  const file = await toXlsx(companySheets(data, await getLang()));
  return new NextResponse(Buffer.from(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": attachment(`${slug(data.company.name)}-data-${data.exportedAt.slice(0, 10)}.xlsx`),
      "Cache-Control": "private, no-store",
    },
  });
}

import "server-only";
import type { getUser } from "@/lib/supabase/server";
import { saveCompanyData } from "@/lib/company/persist";
import { dbError } from "@/lib/action-error";
import { cashBooks } from "./books";
import { loadCashCompany, loadCashEntries } from "./load";

type Db = Awaited<ReturnType<typeof getUser>>["supabase"];
export type CashBooksResult = { ok: true; saved: boolean; heldOut: { unpaidIn: number; unpaidOut: number } } | { ok: false; error: string };

/**
 * Saves a cash-basis set of books built from the cash book, so Financials and the dashboard work as soon as the business
 * moves to the full system. Books the company already has from an upload or Odoo are kept as they are; books built from
 * the cash book before are rebuilt.
 */
export async function saveCashBasisBooks(supabase: Db, companyId: string): Promise<CashBooksResult> {
  const [entries, company, { data: row, error }] = await Promise.all([
    loadCashEntries(companyId), loadCashCompany(companyId),
    supabase.from("companies").select("data_version").eq("id", companyId).maybeSingle(),
  ]);
  if (error || !row) return { ok: false, error: error ? dbError(error, "cashBooks") : "You do not have permission to change this." };
  const { data: last, error: e1 } = await supabase.from("imports").select("report").eq("company_id", companyId).eq("data_version", row.data_version).eq("action", "import").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (e1) return { ok: false, error: dbError(e1, "cashBooks") };
  const fromCashBook = (last?.report as { source?: string } | null)?.source === "cashbook";
  if (!entries.ok) return { ok: false, error: "The cash book couldn't be read just now, so its books weren't built. Try again in a minute." };
  const books = cashBooks(entries.entries, { opening: company.openingCash, today: company.today });
  if (!books.accounts.length) return { ok: true, saved: false, heldOut: books.heldOut };
  if (!fromCashBook) {
    const { count, error: e2 } = await supabase.from("source_accounts").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("version", row.data_version);
    if (e2) return { ok: false, error: dbError(e2, "cashBooks") };
    if (count) return { ok: true, saved: false, heldOut: books.heldOut };
  }
  try {
    await saveCompanyData(supabase, companyId, books.accounts, { kind: "upload", filename: "Cash book (cash basis)", report: { source: "cashbook", basis: "cash", heldOut: books.heldOut } });
  } catch (e) {
    return { ok: false, error: dbError(e as { code?: string; message: string }, "cashBooks") };
  }
  return { ok: true, saved: true, heldOut: books.heldOut };
}

import type { createClient } from "@/lib/supabase/server";
import { booksStartOf, openingAsAtOf, tbCheckOf } from "./time-zone";
import type { DataFacts } from "@/components/data/data-steps";

/**
 * What the Data steps need from the server. The books come from a General Ledger when the upload that made the current
 * figures recorded it as one, or while lines taken from a ledger are kept (sales, expenses or payments with source
 * "ledger"), or when the company syncs with Odoo.
 */
export async function loadDataFacts(supabase: Awaited<ReturnType<typeof createClient>>, id: string, dataVersion: number): Promise<DataFacts> {
  const head = { count: "exact" as const, head: true };
  const [{ data: c }, { data: imports }, s, e, p] = await Promise.all([
    supabase.from("companies").select("source, kpi_config").eq("id", id).maybeSingle(),
    supabase.from("imports").select("data_version, action, report").eq("company_id", id).eq("action", "import").order("created_at", { ascending: false }).limit(40),
    supabase.from("sales_batches").select("id", head).eq("company_id", id).eq("source", "ledger"),
    supabase.from("expense_batches").select("id", head).eq("company_id", id).eq("source", "ledger"),
    // (none before the database has payments from the ledger: migration 0028)
    supabase.from("payment_batches").select("id", head).eq("company_id", id).eq("source", "ledger"),
  ]);
  const reports = (imports ?? []).map((r) => ({ v: r.data_version, r: (r.report ?? {}) as { source?: string; openingBasis?: string; accepted?: { key: string }[] } }));
  const odoo = c?.source === "odoo";
  // The current books, not history: a ledger replaced by summary statements leaves no ledger lines behind.
  const ledger = odoo || reports.find((x) => x.v === dataVersion)?.r.source === "ledger" || !!s.count || !!e.count || !!p.count;
  return {
    ledger, odoo,
    openingInLedger: reports.some((x) => x.r.openingBasis === "file"),
    booksStart: booksStartOf(c?.kpi_config), openingAsAt: openingAsAtOf(c?.kpi_config), tbCheck: tbCheckOf(c?.kpi_config),
    accepted: (reports.find((x) => x.v === dataVersion)?.r.accepted ?? []).map((a) => a.key),
  };
}

import "server-only";
import { DbError } from "@/lib/action-error";
import { loadBalances } from "@/lib/company/balances";
import type { createClient } from "@/lib/supabase/server";
import type { CompanyExport } from "./company-workbook";

type Supa = Awaited<ReturnType<typeof createClient>>;
export type LineTable = "sales_lines" | "expense_lines";
/** Lines per page: each page is one quick request, read from where the last one stopped (never an ever-growing offset). */
export const LINE_PAGE = 5000;
const COLS: Record<LineTable, string> = {
  sales_lines: "id, day, period, doc, series, customer, product, category, salesperson, qty, amount, cost, source",
  expense_lines: "id, day, period, doc, series, supplier, account, cls, category, label, amount, source",
};
type Line = Record<string, unknown> & { id: number; period: string };

/** One page of a company's lines after the line `after` (by id), and where the next page starts (null: none left). */
export async function readLinePage(supabase: Supa, table: LineTable, companyId: string, after: number): Promise<{ rows: Line[]; next: number | null }> {
  const { data, error } = await supabase.from(table).select(COLS[table]).eq("company_id", companyId).gt("id", after).order("id").limit(LINE_PAGE);
  if (error) throw new DbError(error);
  const rows = (data ?? []) as unknown as Line[];
  return { rows, next: rows.length === LINE_PAGE ? rows[rows.length - 1].id : null };
}

/** Every line, page by page, in month order (the order the export shows them). */
export async function readAllLines(supabase: Supa, table: LineTable, companyId: string): Promise<Line[]> {
  const out: Line[] = [];
  for (let after: number | null = 0; after !== null;) {
    const p: { rows: Line[]; next: number | null } = await readLinePage(supabase, table, companyId, after);
    out.push(...p.rows);
    after = p.next;
  }
  return out.sort((a, b) => a.period.localeCompare(b.period) || a.id - b.id);
}

/** Everything the company export holds except its sales and expense lines; null when the company can't be read. */
export async function loadExportMeta(supabase: Supa, companyId: string): Promise<Omit<CompanyExport, "sales" | "expenses"> | null> {
  const { data: c, error } = await supabase.from("companies").select("*").eq("id", companyId).maybeSingle();
  if (error) throw new DbError(error);
  if (!c) return null;
  const [org, accts, imports, commentary, reports, odoo, bal] = await Promise.all([
    supabase.from("organizations").select("name").eq("id", c.org_id).maybeSingle(),
    supabase.from("source_accounts").select("id, code, name, statement, class").eq("company_id", c.id).eq("version", c.data_version).order("sort_order"),
    supabase.from("imports").select("created_at, action, kind, filename, status, data_version").eq("company_id", c.id).order("created_at"),
    supabase.from("commentary").select("period_key, section, source, updated_at, body").eq("company_id", c.id).order("period_key"),
    supabase.from("reports").select("title, period_type, period_end, status, share_token, expires_at, published_at, created_at").eq("company_id", c.id).order("created_at"),
    // Never the encrypted API key: only the columns listed here leave the database.
    supabase.from("odoo_connections").select("url, db, login, odoo_company_name, months_history, status, last_sync_at").eq("company_id", c.id).maybeSingle(),
    // One call: company_balances checks membership once, instead of paging the joined table row by row (timed out).
    loadBalances(supabase, c.id, c.data_version),
  ]);
  const failed = [org, accts, imports, commentary, reports].find((r) => r.error)?.error;
  if (failed) throw new DbError(failed);
  const amounts = new Map<string, Record<string, number>>((accts.data ?? []).map((a) => [a.id, {}]));
  for (const b of bal) { const r = amounts.get(b.account_id); if (r) r[b.period] = b.amount; }
  return {
    exportedAt: new Date().toISOString(),
    orgName: org.data?.name ?? "",
    company: c,
    accounts: (accts.data ?? []).map((a) => ({ code: a.code, name: a.name, statement: a.statement, class: a.class, amounts: amounts.get(a.id) ?? {} })),
    imports: imports.data ?? [],
    commentary: commentary.data ?? [],
    reports: (reports.data ?? []).map(({ share_token, ...r }) => ({ ...r, shared: !!share_token })),
    odoo: odoo.data ?? null, // viewers cannot read the connection (RLS) and simply get no sheet
  };
}

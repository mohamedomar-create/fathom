// What a company holds per module, read from data_reset_preview (migration 0031), for the screens that clear data or
// delete the company. Pure: no database calls.

export type ResetModule = "financials" | "sales" | "expenses" | "stock" | "payments" | "end_users";
export type ResetScope = ResetModule | "all";

export const RESET_MODULES: Record<ResetModule, { label: string; keeps: string }> = {
  financials: { label: "Financials (General Ledger and balances)", keeps: "Sales, expense, stock and payment files you uploaded are kept; the lines taken from the ledger go with it. Account classes, the books start and other settings stay." },
  sales: { label: "Sales lines", keeps: "The General Ledger and its revenue stay. Lines taken from the ledger come back with the next ledger upload or Odoo sync." },
  expenses: { label: "Expense lines", keeps: "The General Ledger and its costs stay. Lines taken from the ledger come back with the next ledger upload or Odoo sync." },
  stock: { label: "Stock (valuation, moves, on hand, products)", keeps: "The General Ledger, its stock accounts and its stock postings stay. Remembered column layouts and location types stay." },
  payments: { label: "Receivables, payables and payments", keeps: "The General Ledger and its receivable and payable accounts stay." },
  end_users: { label: "End users and agency statement", keeps: "Sales lines, their amounts and the end user Odoo links give stay; your agency list, order register, joined names and the agency statement go." },
};
const ORDER = Object.keys(RESET_MODULES) as ResetModule[];

const TABLE_LABEL: Record<string, string> = {
  accounts: "accounts", balances: "monthly balances", versions: "saved versions", sales_lines_from_ledger: "sales lines taken from the ledger",
  expense_lines_from_ledger: "expense lines taken from the ledger", stock_postings: "stock postings from the ledger", payments_from_ledger: "payments taken from the ledger",
  commentary: "commentary notes", reports: "reports", sales_lines: "sales lines", expense_lines: "expense lines", valuation_layers: "valuation records",
  stock_moves: "stock moves", on_hand: "on-hand rows", products: "products", import_jobs: "import jobs", ageing_items: "ageing items",
  payment_lines: "payments", end_user_choices: "end-user choices", statement_lines: "statement lines",
};

export interface ResetUpload { name: string; at: string; kind: string }
export interface ResetModuleView { key: ResetModule; label: string; keeps: string; records: number; tables: { key: string; label: string; n: number }[]; uploads: ResetUpload[] }
export interface ResetPreview { company: string; total: number; files: string[]; modules: ResetModuleView[] }

const num = (x: unknown) => { const n = typeof x === "string" ? Number(x) : x; return typeof n === "number" && Number.isFinite(n) ? n : 0; };
const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null);

/** The preview, or null when it is missing or not what the database sends (never read as "nothing to clear"). */
export function parseResetPreview(raw: unknown): ResetPreview | null {
  const r = obj(raw);
  const mods = obj(r?.modules);
  if (!r || !mods) return null;
  const modules = ORDER.filter((k) => obj(mods[k])).map((key): ResetModuleView => {
    const m = obj(mods[key])!;
    const tables = Object.entries(obj(m.tables) ?? {}).map(([k, v]) => ({ key: k, label: TABLE_LABEL[k] ?? k.replace(/_/g, " "), n: num(v) })).filter((t) => t.n > 0);
    const uploads = (Array.isArray(m.uploads) ? m.uploads : []).map(obj).filter((u): u is Record<string, unknown> => u !== null)
      .map((u) => ({ name: String(u.name ?? ""), at: String(u.at ?? ""), kind: String(u.kind ?? "") }));
    return { key, ...RESET_MODULES[key], records: num(m.records), tables, uploads };
  });
  return { company: String(r.company ?? ""), total: num(r.total), files: (Array.isArray(r.files) ? r.files : []).filter((f): f is string => typeof f === "string"), modules };
}

/** The record count the person was shown for a scope: what clear_company_data checks before it removes anything. */
export function confirmCount(p: ResetPreview, scope: ResetScope): number {
  return scope === "all" ? p.total : p.modules.find((m) => m.key === scope)?.records ?? 0;
}

/** Why the clearing section cannot work (shown in its place, never hidden), or null when the preview was read. */
export function resetUnavailable(error: { code?: string; message?: string } | null): string | null {
  if (!error) return null;
  if (error.code === "PGRST202" || error.code === "42883" || /data_reset_preview/.test(error.message ?? "")) return "Clearing data needs the latest database update (migration 0031). Ask the site owner to run it; until then only deleting the whole company is available.";
  if (error.code === "42501") return "You don't have permission to see or clear this company's data.";
  return "What this company holds could not be read just now. Reload the page to try again.";
}

import "server-only";
import type { getUser } from "@/lib/supabase/server";
import type { ClassKey } from "@/lib/engine";
import type { BudgetLine, BudgetProduct } from "@/lib/engine/budget";
import { storedRow, type BudgetRow, type BudgetSetup } from "@/lib/engine/budget-builder";
import { COGS_SUPPLIER } from "@/lib/engine/expenses";

type Supa = Awaited<ReturnType<typeof getUser>>["supabase"];

export interface BudgetVersionInfo {
  id: string; fy: string; name: string; kind: "original" | "revision"; status: "draft" | "approved";
  basedOn: string | null; approvedAt: string | null; createdAt: string; updatedAt: string;
}
export interface BudgetSet {
  versions: BudgetVersionInfo[];
  current: { id: string; lines: BudgetLine[]; products: BudgetProduct[]; rows: BudgetRow[]; setup: BudgetSetup | null } | null;
  error?: string;
}

const PAGE = 1000;

/** A read error that keeps the database's code (42P01 and the like). */
class ReadError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}

/** Missing table or column (0053 not pasted yet): Postgres 42P01 / 42703, PostgREST PGRST204 / PGRST205. */
const MISSING = new Set(["42P01", "42703", "PGRST204", "PGRST205"]);
const isMissing = (e: unknown) => e instanceof ReadError && !!e.code && MISSING.has(e.code);

/** Reads every row of a query, a page at a time (the API answers at most 1,000 rows a call). */
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new ReadError(error.message, error.code);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

/**
 * The company's budget versions (newest first) and the lines and products of one: the one asked for, else the latest
 * approved, else the latest. Members only (row security).
 */
export async function loadBudgets(supabase: Supa, companyId: string, versionId?: string | null): Promise<BudgetSet> {
  const { data: vs, error } = await supabase.from("budget_versions")
    .select("id, fy, name, kind, status, based_on, approved_at, created_at, updated_at").eq("company_id", companyId).order("created_at", { ascending: false });
  if (error) return { versions: [], current: null, error: error.code === "42P01" ? "missing" : "read" };
  const versions: BudgetVersionInfo[] = (vs ?? []).map((v) => ({ id: v.id, fy: v.fy, name: v.name, kind: v.kind, status: v.status, basedOn: v.based_on, approvedAt: v.approved_at, createdAt: v.created_at, updatedAt: v.updated_at }));
  const pick = versions.find((v) => v.id === versionId) ?? versions.find((v) => v.status === "approved") ?? versions[0];
  if (!pick) return { versions, current: null };
  try {
    return { versions, current: { id: pick.id, ...(await loadBudgetRows(supabase, pick.id, { builder: true })) } };
  } catch {
    return { versions, current: null, error: "read" };
  }
}

export interface YearBudget { fy: string; name: string; status: "draft" | "approved"; lines: BudgetLine[]; products: BudgetProduct[] }

/**
 * One budget per financial year: the latest approved version (a revision approved later wins), else, when drafts are
 * asked for, the latest draft. Empty when there is none or it couldn't be read (never an error on the page).
 */
export async function loadYearBudgets(supabase: Supa, companyId: string, opts: { drafts?: boolean } = {}): Promise<YearBudget[]> {
  const { data: vs, error } = await supabase.from("budget_versions").select("id, fy, name, status, approved_at, created_at").eq("company_id", companyId);
  if (error || !vs) return [];
  const pick = new Map<string, (typeof vs)[number]>();
  const rank = (v: (typeof vs)[number]) => (v.status === "approved" ? `1${v.approved_at ?? ""}` : `0${v.created_at}`);
  for (const v of vs) {
    if (v.status !== "approved" && !opts.drafts) continue;
    const cur = pick.get(v.fy);
    if (!cur || rank(v) > rank(cur)) pick.set(v.fy, v);
  }
  try {
    return await Promise.all([...pick.values()].map(async (v) => ({ fy: v.fy, name: v.name, status: v.status, ...(await loadBudgetRows(supabase, v.id)) })));
  } catch {
    return [];
  }
}

/** The company's budget setup (products, groups, rental streams, merged expenses); null when none is saved or the table is missing. */
export async function loadBudgetSetup(supabase: Supa, companyId: string): Promise<BudgetSetup | null> {
  const { data, error } = await supabase.from("budget_setups").select("setup").eq("company_id", companyId).maybeSingle();
  if (error || !data) return null;
  return data.setup as unknown as BudgetSetup;
}

/**
 * One version's lines and products, every row (paged); with `builder`, also its builder rows and setup (the budget page
 * only: Financials, reports and the export read the lines). Throws when they can't be read, except that a missing
 * budget_rows table or budget_versions.setup column (0053 not pasted yet) reads as no rows and no setup, so older
 * budgets still show.
 */
export async function loadBudgetRows(supabase: Supa, versionId: string): Promise<{ lines: BudgetLine[]; products: BudgetProduct[] }>;
export async function loadBudgetRows(supabase: Supa, versionId: string, opts: { builder: true }): Promise<{ lines: BudgetLine[]; products: BudgetProduct[]; rows: BudgetRow[]; setup: BudgetSetup | null }>;
export async function loadBudgetRows(supabase: Supa, versionId: string, opts: { builder?: boolean } = {}): Promise<{ lines: BudgetLine[]; products: BudgetProduct[]; rows?: BudgetRow[]; setup?: BudgetSetup | null }> {
  const lines = await all((a, b) => supabase.from("budget_lines").select("key, cls, label, month, amount").eq("version_id", versionId).order("key").order("month").range(a, b));
  const products = await all((a, b) => supabase.from("budget_products").select("product, category, month, units, price, unit_cost").eq("version_id", versionId).order("product").order("month").range(a, b));
  const out = {
    lines: lines.map((l) => ({ key: l.key, cls: l.cls as ClassKey, label: l.label, month: l.month, amount: Number(l.amount) })),
    products: products.map((p) => ({ product: p.product, category: p.category, month: p.month, units: Number(p.units), price: Number(p.price), unit_cost: p.unit_cost === null ? null : Number(p.unit_cost) })),
  };
  if (!opts.builder) return out;
  let rows: BudgetRow[] = [];
  try {
    rows = (await all((a, b) => supabase.from("budget_rows").select("view, key, label, mode, basis, cost, months").eq("version_id", versionId).order("view").order("key").range(a, b))).map(storedRow);
  } catch (e) {
    if (!isMissing(e)) throw e;
  }
  const { data: ver, error } = await supabase.from("budget_versions").select("setup").eq("id", versionId).maybeSingle();
  if (error && !MISSING.has(error.code ?? "")) throw new ReadError(error.message, error.code);
  return { ...out, rows, setup: (error ? null : ver?.setup ?? null) as unknown as BudgetSetup | null };
}

/**
 * Of the given cost-of-sales accounts, `stock`: those whose expense lines are all stock cost-of-goods postings (supplier
 * COGS_SUPPLIER), which the budget builder may leave out when products carry their cost; `mixed`: those holding such
 * postings and other lines, which means the builder budgets no product cost (it can't leave out part of an account).
 * Two counts per account (stock lines, all lines; at most 20 accounts); a failed read lists the account in neither.
 */
export async function loadStockCogsAccounts(supabase: Supa, companyId: string, accounts: string[]): Promise<{ stock: string[]; mixed: string[] }> {
  const stockOnly: string[] = [];
  const mixed: string[] = [];
  await Promise.all(accounts.slice(0, 20).map(async (account) => {
    const q = () => supabase.from("expense_lines").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("account", account);
    // All lines against the stock ones (a "not this supplier" filter would miss lines with no supplier).
    const [stock, total] = await Promise.all([q().eq("supplier", COGS_SUPPLIER), q()]);
    if (stock.error || total.error || stock.count == null || total.count == null || stock.count <= 0) return;
    (total.count > stock.count ? mixed : stockOnly).push(account);
  }));
  return { stock: stockOnly.sort(), mixed: mixed.sort() };
}

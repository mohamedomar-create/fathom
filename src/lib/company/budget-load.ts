import "server-only";
import type { getUser } from "@/lib/supabase/server";
import type { ClassKey } from "@/lib/engine";
import type { BudgetLine, BudgetProduct } from "@/lib/engine/budget";

type Supa = Awaited<ReturnType<typeof getUser>>["supabase"];

export interface BudgetVersionInfo {
  id: string; fy: string; name: string; kind: "original" | "revision"; status: "draft" | "approved";
  basedOn: string | null; approvedAt: string | null; createdAt: string; updatedAt: string;
}
export interface BudgetSet { versions: BudgetVersionInfo[]; current: { id: string; lines: BudgetLine[]; products: BudgetProduct[] } | null; error?: string }

const PAGE = 1000;

/** Reads every row of a query, a page at a time (the API answers at most 1,000 rows a call). */
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
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
    return { versions, current: { id: pick.id, ...(await loadBudgetRows(supabase, pick.id)) } };
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

/** One version's lines and products, every row (paged). Throws when they can't be read. */
export async function loadBudgetRows(supabase: Supa, versionId: string): Promise<{ lines: BudgetLine[]; products: BudgetProduct[] }> {
  const lines = await all((a, b) => supabase.from("budget_lines").select("key, cls, label, month, amount").eq("version_id", versionId).order("key").order("month").range(a, b));
  const products = await all((a, b) => supabase.from("budget_products").select("product, category, month, units, price, unit_cost").eq("version_id", versionId).order("product").order("month").range(a, b));
  return {
    lines: lines.map((l) => ({ key: l.key, cls: l.cls as ClassKey, label: l.label, month: l.month, amount: Number(l.amount) })),
    products: products.map((p) => ({ product: p.product, category: p.category, month: p.month, units: Number(p.units), price: Number(p.price), unit_cost: p.unit_cost === null ? null : Number(p.unit_cost) })),
  };
}

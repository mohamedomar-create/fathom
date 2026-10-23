import "server-only";
import { cache } from "react";
import { getUser } from "@/lib/supabase/server";
import { loadCompanyMeta } from "./meta";
import { loaded, type Loaded } from "./loaded";
import { logOp, newRef, withRetry } from "@/lib/observe";
import type { SalesLine } from "@/lib/ingest/sales";
import type { ExpenseLine } from "@/lib/ingest/expenses";
import type { ClassKey } from "@/lib/engine";

/** A stored line, with its id so it can be changed or deleted, and whether it came from a file (only those can be). */
export type StoredSale = SalesLine & { id: number; fromFile: boolean };
export type StoredExpense = ExpenseLine & { id: number; fromFile: boolean };
export interface SimpleLines { sales: StoredSale[]; expenses: StoredExpense[]; /** The database has the Simple columns (0036). */ full: boolean }
export const EMPTY_LINES: SimpleLines = { sales: [], expenses: [], full: true };

const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
const str = (v: unknown) => (typeof v === "string" ? v : "");
const day = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 10) : null);
const bool = (v: unknown) => (v === true || v === false ? v : null);

type Row = Record<string, unknown>;
const toSale = (r: Row): StoredSale => ({
  id: Number(r.id), fromFile: r.source === "file", day: day(r.day), period: str(r.period), doc: str(r.doc), series: "",
  customer: str(r.customer), product: str(r.product), category: str(r.category), salesperson: "", qty: num(r.qty),
  amount: Number(r.amount) || 0, cost: num(r.cost),
  ...(r.channel ? { channel: str(r.channel) } : {}), paid: bool(r.paid), paidOn: day(r.paidOn ?? r.paid_on),
});
const toExpense = (r: Row): StoredExpense => ({
  id: Number(r.id), fromFile: r.source === "file", day: day(r.day), period: str(r.period), doc: str(r.doc), series: "",
  supplier: str(r.supplier), account: str(r.account), cls: (r.cls as ClassKey | null) ?? null, category: str(r.category), label: str(r.label),
  amount: Number(r.amount) || 0, paid: bool(r.paid), paidOn: day(r.paidOn ?? r.paid_on),
});

/** Before the Simple update (0036): the plain columns straight from the tables, a page at a time. */
async function plainLines(companyId: string): Promise<SimpleLines> {
  const { supabase } = await getUser();
  const page = async (table: "sales_lines" | "expense_lines", cols: string) => {
    const out: Row[] = [];
    for (let from = 0; from < 100_000; from += 1000) {
      const { data, error } = await supabase.from(table).select(cols).eq("company_id", companyId).order("period").order("id").range(from, from + 999);
      if (error) throw error;
      out.push(...((data ?? []) as unknown as Row[]));
      if (!data || data.length < 1000) break;
    }
    return out;
  };
  const [s, e] = await Promise.all([
    page("sales_lines", "id, source, day, period, doc, customer, product, category, qty, amount, cost"),
    page("expense_lines", "id, source, day, period, doc, supplier, account, cls, category, label, amount"),
  ]);
  return { sales: s.map(toSale), expenses: e.map(toExpense), full: false };
}

/** Every sales and expense line of a Simple company (members only), with whether they could be read. */
export const loadSimpleLines = cache(async (companyId: string): Promise<Loaded<SimpleLines>> => {
  await loadCompanyMeta(companyId);
  const { supabase } = await getUser();
  const ref = newRef();
  const t0 = Date.now();
  const { result, attempts } = await withRetry(() => supabase.rpc("simple_lines", { p_company: companyId }));
  try {
    let data: SimpleLines;
    if (!result.error) {
      const raw = (result.data ?? {}) as { sales?: Row[]; expenses?: Row[] };
      data = { sales: (raw.sales ?? []).map(toSale), expenses: (raw.expenses ?? []).map(toExpense), full: true };
    } else if (result.error.code === "PGRST202") data = await plainLines(companyId);
    else throw result.error;
    const empty = !data.sales.length && !data.expenses.length;
    logOp({ op: "simple_lines", company: companyId, ms: Date.now() - t0, attempts, outcome: data.full ? (empty ? "empty" : "ok") : "fallback" });
    return loaded(empty ? "empty" : "ready", data);
  } catch (e) {
    const code = (e as { code?: string }).code;
    logOp({ op: "simple_lines", company: companyId, ms: Date.now() - t0, attempts, outcome: "failed", code, ref });
    return loaded("failed", EMPTY_LINES, null, { ref, code });
  }
});

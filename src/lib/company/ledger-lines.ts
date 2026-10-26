import "server-only";
import { DbError } from "@/lib/action-error";
import { isCostLine, type ClassKey } from "@/lib/engine";
import { untied, type LineKind } from "./ledger-tie";
import type { Json } from "@/lib/supabase/database.types";
import type { createClient } from "@/lib/supabase/server";
import type { SalesLine } from "@/lib/ingest/sales";
import type { ExpenseLine } from "@/lib/ingest/expenses";
import type { StockLedgerLine } from "@/lib/ingest/inventory";

/**
 * Sales and expense lines taken from a General Ledger (source "ledger") mirror the accounts loaded: when months of the
 * accounts are replaced or undone, their ledger lines go too. Lines from a sales or expenses file are never touched here.
 * Everything runs with the signed-in user's rights (only a company's editors can delete or add its lines).
 */
type Supa = Awaited<ReturnType<typeof createClient>>;
export type { LineKind };
/** What a General Ledger leaves behind besides the accounts: sales and expense lines, and its stock postings (Inventory tie-outs). */
export type LedgerKind = LineKind | "stock";
const TABLES: Record<LedgerKind, { lines: "sales_lines" | "expense_lines" | "stock_ledger_lines"; batches: "sales_batches" | "expense_batches" | "stock_ledger_batches" }> = {
  sales: { lines: "sales_lines", batches: "sales_batches" },
  expenses: { lines: "expense_lines", batches: "expense_batches" },
  stock: { lines: "stock_ledger_lines", batches: "stock_ledger_batches" },
};

/** Removes the ledger lines of these months (or all of them), and the ledger batches left with no months. */
export async function clearLedger(supabase: Supa, companyId: string, periods: string[] | "all", kinds: LedgerKind[] = ["sales", "expenses", "stock"]): Promise<void> {
  if (periods !== "all" && !periods.length) return;
  for (const kind of kinds) {
    const t = TABLES[kind];
    if (periods === "all") {
      // Deleting the batches removes their lines (on delete cascade).
      const { error } = await supabase.from(t.batches).delete().eq("company_id", companyId).eq("source", "ledger");
      if (error) throw new DbError(error);
      continue;
    }
    const del = await supabase.from(t.lines).delete().eq("company_id", companyId).eq("source", "ledger").in("period", periods);
    if (del.error) throw new DbError(del.error);
    const { data: batches, error } = await supabase.from(t.batches).select("id, periods").eq("company_id", companyId).eq("source", "ledger");
    if (error) throw new DbError(error);
    const gone = new Set(periods);
    for (const b of batches ?? []) {
      const left = ((b.periods as string[] | null) ?? []).filter((p) => !gone.has(p));
      if (left.length === (b.periods ?? []).length) continue;
      const r = left.length ? await supabase.from(t.batches).update({ periods: left }).eq("id", b.id) : await supabase.from(t.batches).delete().eq("id", b.id);
      if (r.error) throw new DbError(r.error);
    }
  }
}


/** What the ledger lines add up to per month, for sales and for expenses. */
export async function ledgerTotals(supabase: Supa, companyId: string): Promise<Record<LineKind, Record<string, number>>> {
  const { data, error } = await supabase.rpc("ledger_line_totals", { p_company: companyId });
  if (!error && data && typeof data === "object") {
    const o = data as Record<string, Record<string, unknown>>;
    const num = (r: Record<string, unknown> = {}) => Object.fromEntries(Object.entries(r).map(([p, v]) => [p, Number(v)]));
    return { sales: num(o.sales), expenses: num(o.expenses) };
  }
  // Without the function: add the lines up here (row-level security applies).
  const out: Record<LineKind, Record<string, number>> = { sales: {}, expenses: {} };
  for (const kind of ["sales", "expenses"] as const) {
    for (let from = 0; from < 2_000_000; from += 1000) {
      const { data: rows, error: e } = await supabase.from(TABLES[kind].lines).select(kind === "expenses" ? "period, amount, cls" : "period, amount").eq("company_id", companyId).eq("source", "ledger").range(from, from + 999);
      if (e) throw new DbError(e);
      // Goods bought for stock are expense lines too, but not costs: they never count against the P&L.
      for (const r of (rows ?? []) as unknown as { period: string; amount: number; cls?: string | null }[]) if (kind === "sales" || isCostLine(r.cls ?? null)) out[kind][r.period] = (out[kind][r.period] ?? 0) + Number(r.amount);
      if (!rows || rows.length < 1000) break;
    }
  }
  return out;
}

/** After the accounts change (an undo or a restore): clears the months whose ledger lines no longer tie. */
export async function keepLedgerInStep(supabase: Supa, companyId: string, accounts: { cls: ClassKey; amounts: Record<string, number> }[]): Promise<Record<LineKind, string[]>> {
  const bad = untied(await ledgerTotals(supabase, companyId), accounts);
  await clearLedger(supabase, companyId, bad.sales, ["sales"]);
  await clearLedger(supabase, companyId, bad.expenses, ["expenses"]);
  return bad;
}

const CHUNK = 4000;
/** Saves ledger lines on the server (the Odoo sync): a batch per kind replaces those months, then the lines in chunks. */
export async function saveLedgerLines(supabase: Supa, companyId: string, userId: string, kind: LedgerKind, lines: (SalesLine | ExpenseLine | StockLedgerLine)[], filename: string): Promise<number> {
  if (!lines.length) return 0;
  if (kind === "stock") return saveStockLines(supabase, companyId, lines as StockLedgerLine[], filename);
  const periods = [...new Set(lines.map((l) => l.period))].sort();
  const begin = kind === "sales" ? "begin_sales_batch" : "begin_expense_batch";
  const add = kind === "sales" ? "add_sales_lines" : "add_expense_lines";
  const b = await supabase.rpc(begin, { p_company: companyId, p_source: "ledger", p_periods: periods, p_filename: filename, p_report: {} as Json });
  if (b.error) throw new DbError(b.error);
  const batch = b.data as string;
  let saved = 0;
  for (let i = 0; i < lines.length; i += CHUNK) {
    const part = (lines as (SalesLine | ExpenseLine)[]).slice(i, i + CHUNK).map((x) => { const { src, ...l } = x; void src; return l; });
    const r = await supabase.rpc(add, { p_batch: batch, p_lines: part as unknown as Json });
    if (r.error) throw new DbError(r.error);
    saved += r.data as number;
  }
  return saved;
}

/** The ledger's stock postings (the Odoo sync): a batch replaces those months, then the lines. Skipped before the Inventory update. */
async function saveStockLines(supabase: Supa, companyId: string, lines: StockLedgerLine[], filename: string): Promise<number> {
  const periods = [...new Set(lines.map((l) => l.period))].sort();
  const b = await supabase.rpc("begin_stock_ledger_batch", { p_company: companyId, p_periods: periods, p_filename: filename });
  if (b.error) throw new DbError(b.error);
  let saved = 0;
  for (let i = 0; i < lines.length; i += CHUNK) {
    const r = await supabase.rpc("add_stock_ledger_lines", { p_batch: b.data as string, p_lines: lines.slice(i, i + CHUNK) as unknown as Json });
    if (r.error) throw new DbError(r.error);
    saved += r.data as number;
  }
  return saved;
}

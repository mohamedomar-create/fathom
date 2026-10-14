import "server-only";
import type { ClassKey } from "@/lib/engine";
import { untied, type LineKind } from "./ledger-tie";
import type { Json } from "@/lib/supabase/database.types";
import type { createClient } from "@/lib/supabase/server";
import type { SalesLine } from "@/lib/ingest/sales";
import type { ExpenseLine } from "@/lib/ingest/expenses";

/**
 * Sales and expense lines taken from a General Ledger (source "ledger") mirror the accounts loaded: when months of the
 * accounts are replaced or undone, their ledger lines go too. Lines from a sales or expenses file are never touched here.
 * Everything runs with the signed-in user's rights (only a company's editors can delete or add its lines).
 */
type Supa = Awaited<ReturnType<typeof createClient>>;
export type { LineKind };
const TABLES: Record<LineKind, { lines: "sales_lines" | "expense_lines"; batches: "sales_batches" | "expense_batches" }> = {
  sales: { lines: "sales_lines", batches: "sales_batches" },
  expenses: { lines: "expense_lines", batches: "expense_batches" },
};

/** Removes the ledger lines of these months (or all of them), and the ledger batches left with no months. */
export async function clearLedger(supabase: Supa, companyId: string, periods: string[] | "all", kinds: LineKind[] = ["sales", "expenses"]): Promise<void> {
  if (periods !== "all" && !periods.length) return;
  for (const kind of kinds) {
    const t = TABLES[kind];
    if (periods === "all") {
      // Deleting the batches removes their lines (on delete cascade).
      const { error } = await supabase.from(t.batches).delete().eq("company_id", companyId).eq("source", "ledger");
      if (error && !missing(error)) throw new Error(error.message);
      continue;
    }
    const del = await supabase.from(t.lines).delete().eq("company_id", companyId).eq("source", "ledger").in("period", periods);
    if (del.error) { if (missing(del.error)) continue; throw new Error(del.error.message); }
    const { data: batches, error } = await supabase.from(t.batches).select("id, periods").eq("company_id", companyId).eq("source", "ledger");
    if (error) throw new Error(error.message);
    const gone = new Set(periods);
    for (const b of batches ?? []) {
      const left = ((b.periods as string[] | null) ?? []).filter((p) => !gone.has(p));
      if (left.length === (b.periods ?? []).length) continue;
      const r = left.length ? await supabase.from(t.batches).update({ periods: left }).eq("id", b.id) : await supabase.from(t.batches).delete().eq("id", b.id);
      if (r.error) throw new Error(r.error.message);
    }
  }
}

/** A table or function the database does not have yet (its update not applied): treated as "nothing there". */
const missing = (e: { code?: string }) => e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST202";

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
      const { data: rows, error: e } = await supabase.from(TABLES[kind].lines).select("period, amount").eq("company_id", companyId).eq("source", "ledger").range(from, from + 999);
      if (e) { if (missing(e)) break; throw new Error(e.message); }
      for (const r of rows ?? []) out[kind][r.period] = (out[kind][r.period] ?? 0) + Number(r.amount);
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
export async function saveLedgerLines(supabase: Supa, companyId: string, userId: string, kind: LineKind, lines: (SalesLine | ExpenseLine)[], filename: string): Promise<number> {
  if (!lines.length) return 0;
  const t = TABLES[kind];
  const periods = [...new Set(lines.map((l) => l.period))].sort();
  const begin = kind === "sales" ? "begin_sales_batch" : "begin_expense_batch";
  const add = kind === "sales" ? "add_sales_lines" : "add_expense_lines";
  let batch: string;
  const b = await supabase.rpc(begin, { p_company: companyId, p_source: "ledger", p_periods: periods, p_filename: filename, p_report: {} as Json });
  if (!b.error) batch = b.data as string;
  else if (missing(b.error)) {
    await clearLedger(supabase, companyId, periods, [kind]);
    const ins = await supabase.from(t.batches).insert({ company_id: companyId, source: "ledger", periods, filename, report: {} as Json, created_by: userId }).select("id").single();
    if (ins.error) throw new Error(ins.error.message);
    batch = ins.data.id;
  } else throw new Error(b.error.message);
  let saved = 0;
  for (let i = 0; i < lines.length; i += CHUNK) {
    const part = lines.slice(i, i + CHUNK).map((x) => { const { src, ...l } = x; void src; return l; });
    const r = await supabase.rpc(add, { p_batch: batch, p_lines: part as unknown as Json });
    if (!r.error) { saved += r.data as number; continue; }
    if (!missing(r.error)) throw new Error(r.error.message);
    const ins = await supabase.from(t.lines).insert(part.map((l) => ({ ...l, company_id: companyId, batch_id: batch, source: "ledger" as const })) as never);
    if (ins.error) throw new Error(ins.error.message);
    saved += part.length;
  }
  return saved;
}

"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { dbError, safeError } from "@/lib/action-error";
import { limited, TOO_MANY } from "@/lib/rate-limit";
import type { Json } from "@/lib/supabase/database.types";

const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Ids = z.object({ companyId: z.string().uuid(), batch: z.string().uuid() });
/** Shown when the database does not have the Inventory update yet (migration 0012). */
const NOT_READY = "Inventory is not switched on for this database yet. Ask your administrator to apply the Inventory update.";
const missing = (e: { code?: string }) => e.code === "PGRST202" || e.code === "42P01" || e.code === "PGRST205";

const Layer = z.object({
  odoo_key: z.string().min(1).max(200), day: Day, period: Period, ref: z.string().max(120), kind: z.string().max(30), product: z.string().max(300),
  code: z.string().max(120), category: z.string().max(200), lot: z.string().max(120), qty: z.number().finite(), unit_value: z.number().finite(),
  value: z.number().finite(), partner: z.string().max(200), landed_ref: z.string().max(120),
});
const Move = z.object({
  odoo_key: z.string().min(1).max(200), day: Day, period: Period, ref: z.string().max(120), kind: z.string().max(30), product: z.string().max(300),
  code: z.string().max(120), lot: z.string().max(120), from_loc: z.string().max(200), to_loc: z.string().max(200), qty: z.number().finite(),
  uom: z.string().max(60), partner: z.string().max(200),
});
const OnHandRow = z.object({ product: z.string().max(300), code: z.string().max(120), location: z.string().max(200), lot: z.string().max(120), qty: z.number().finite(), value: z.number().finite().nullable() });
const Product = z.object({ code: z.string().min(1).max(120), name: z.string().max(300), category: z.string().max(200), cost: z.number().finite().nullable(), type: z.string().max(60) });
const LedgerLine = z.object({ day: Day.nullable(), period: Period, ref: z.string().max(120), account: z.string().max(200), amount: z.number().finite() });

const Start = z.object({
  companyId: z.string().uuid(),
  kind: z.enum(["valuation", "moves", "onhand", "products"]),
  periods: z.array(Period).max(240),
  filename: z.string().max(300).optional(),
  mode: z.enum(["replace", "add"]),
  report: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Opens an upload of one kind of Inventory sheet. Under "replace" the database removes this kind's records for these months
 * and every earlier upload of the same file; under "add" it removes nothing.
 */
export async function startInventoryBatch(input: z.input<typeof Start>): Promise<{ ok: true; batch: string } | { ok: false; error: string }> {
  const v = Start.safeParse(input);
  if (!v.success) return { ok: false, error: "The stock data is not valid: " + v.error.issues[0]?.message };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (await limited(supabase, `inventory:${user.id}`, 3600, 60)) return { ok: false, error: TOO_MANY };
  try {
    const { data, error } = await supabase.rpc("begin_inventory_batch", {
      p_company: v.data.companyId, p_kind: v.data.kind, p_periods: [...new Set(v.data.periods)].sort(), p_filename: v.data.filename, p_mode: v.data.mode, p_report: (v.data.report ?? {}) as Json,
    });
    if (error) return { ok: false, error: missing(error) ? NOT_READY : dbError(error, "begin_inventory_batch") };
    return { ok: true, batch: data as string };
  } catch (e) {
    return { ok: false, error: safeError(e, "startInventoryBatch") };
  }
}

/** Adds up to 3,000 valuation layers or move lines to an open upload; rows already stored (same Odoo ID) are counted, not added. */
export async function addInventoryRows(companyId: string, batch: string, kind: "valuation" | "moves", rows: unknown[], last = false): Promise<{ ok: true; added: number; already: number } | { ok: false; error: string }> {
  const ids = Ids.safeParse({ companyId, batch });
  const rs = (kind === "valuation" ? z.array(Layer) : z.array(Move)).min(1).max(3000).safeParse(rows);
  if (!ids.success || !rs.success || (kind !== "valuation" && kind !== "moves")) return { ok: false, error: "The stock rows are not valid." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  try {
    const { data, error } = await supabase.rpc(kind === "valuation" ? "add_stock_layers" : "add_stock_moves", { p_batch: batch, p_rows: rs.data as unknown as Json });
    if (error) return { ok: false, error: missing(error) ? NOT_READY : dbError(error, kind === "valuation" ? "add_stock_layers" : "add_stock_moves") };
    const out = data as { added: number; already: number };
    if (last) revalidatePath(`/company/${companyId}`, "layout");
    return { ok: true, added: Number(out.added), already: Number(out.already) };
  } catch (e) {
    return { ok: false, error: safeError(e, "addInventoryRows") };
  }
}

/** Replaces the stock-on-hand snapshot of one date. */
export async function setOnHand(companyId: string, batch: string, asOf: string, rows: unknown[]): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  const ids = Ids.safeParse({ companyId, batch });
  const d = Day.safeParse(asOf);
  const rs = z.array(OnHandRow).min(1).max(20000).safeParse(rows);
  if (!ids.success || !d.success || !rs.success) return { ok: false, error: "The stock-on-hand rows are not valid." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  try {
    const { data, error } = await supabase.rpc("set_stock_onhand", { p_batch: batch, p_as_of: asOf, p_rows: rs.data as unknown as Json });
    if (error) return { ok: false, error: missing(error) ? NOT_READY : dbError(error, "set_stock_onhand") };
    revalidatePath(`/company/${companyId}`, "layout");
    return { ok: true, saved: data as number };
  } catch (e) {
    return { ok: false, error: safeError(e, "setOnHand") };
  }
}

/** Keeps the latest products list. */
export async function setProducts(companyId: string, rows: unknown[]): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  const id = z.string().uuid().safeParse(companyId);
  const rs = z.array(Product).min(1).max(20000).safeParse(rows);
  if (!id.success || !rs.success) return { ok: false, error: "The products list is not valid." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  try {
    const { data, error } = await supabase.rpc("set_inventory_products", { p_company: companyId, p_rows: rs.data as unknown as Json });
    if (error) return { ok: false, error: missing(error) ? NOT_READY : dbError(error, "set_inventory_products") };
    revalidatePath(`/company/${companyId}`, "layout");
    return { ok: true, saved: data as number };
  } catch (e) {
    return { ok: false, error: safeError(e, "setProducts") };
  }
}

/** Opens the ledger's stock postings for these months (they replace what was there). */
export async function startStockLedgerBatch(companyId: string, periods: string[], filename: string): Promise<{ ok: true; batch: string } | { ok: false; error: string }> {
  const id = z.string().uuid().safeParse(companyId);
  const ps = z.array(Period).min(1).max(600).safeParse(periods);
  if (!id.success || !ps.success) return { ok: false, error: "Invalid request." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  try {
    const { data, error } = await supabase.rpc("begin_stock_ledger_batch", { p_company: companyId, p_periods: [...new Set(ps.data)].sort(), p_filename: filename.slice(0, 300) });
    // Before the Inventory update the ledger's stock postings are simply not kept; the accounts still save.
    if (error) return missing(error) ? { ok: true, batch: "" } : { ok: false, error: dbError(error, "begin_stock_ledger_batch") };
    return { ok: true, batch: data as string };
  } catch (e) {
    return { ok: false, error: safeError(e, "startStockLedgerBatch") };
  }
}

export async function addStockLedgerLines(companyId: string, batch: string, lines: unknown[]): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  const ids = Ids.safeParse({ companyId, batch });
  const ls = z.array(LedgerLine).min(1).max(4000).safeParse(lines);
  if (!ids.success || !ls.success) return { ok: false, error: "The ledger's stock lines are not valid." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  try {
    const { data, error } = await supabase.rpc("add_stock_ledger_lines", { p_batch: batch, p_lines: ls.data as unknown as Json });
    if (error) return { ok: false, error: dbError(error, "add_stock_ledger_lines") };
    return { ok: true, saved: data as number };
  } catch (e) {
    return { ok: false, error: safeError(e, "addStockLedgerLines") };
  }
}

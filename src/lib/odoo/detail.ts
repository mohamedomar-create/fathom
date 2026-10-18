// The detail an upload gives besides the balances, read from Odoo in pages: sales lines by product (customer invoices and
// credit notes), stock valuation records, stock moves and stock on hand. Each page is mapped to the same records the
// uploads store, so the pages read a synced company exactly as an uploaded one. Reading only, every answer checked.
import { z } from "zod";
import { OdooClient, OdooError } from "./client";
import { DetailLines, trust } from "./schema";
import type { ClassKey } from "@/lib/engine";
import type { LedgerEntry } from "@/lib/ingest/extract";
import { EXPENSE_CLASSES, expensesFromLedger, type ExpenseLine } from "@/lib/ingest/expenses";
import { stockFromLedger, type StockLedgerLine } from "@/lib/ingest/inventory";
import { salesFromLedger, seriesOf, splitLabel, NO_CUSTOMER, type SalesLine } from "@/lib/ingest/sales";
import { layerKind, moveKind, splitProduct, usageType, type LocationTypes, type MoveKind } from "@/lib/ingest/inventory";

const id = z.number().int().positive();
const amount = z.union([z.number(), z.literal(false), z.null()]).transform((x) => (typeof x === "number" ? x : 0)).refine((x) => Number.isFinite(x) && Math.abs(x) <= 1e15, "amount out of range");
const m2o = z.union([z.tuple([id, z.string().transform((s) => s.trim().slice(0, 300))]), z.literal(false), z.null()]).transform((x) => x ?? false as const);
const text = z.union([z.string(), z.literal(false), z.null()]).transform((s) => (typeof s === "string" ? s.trim().slice(0, 500) : ""));
const stamp = z.string().regex(/^\d{4}-\d{2}-\d{2}/, "not a date").transform((s) => s.slice(0, 10));
const many = <T extends z.ZodTypeAny>(row: T) => z.array(row).max(10_000);

export const PAGE = { sales: 5000, stock: 3000 } as const;
export type Part = "ledger" | "sales" | "moves" | "valuation" | "onhand";

export interface DetailCtx { client: OdooClient; companyId: number; major: number; includeBranches: boolean }
const company = (c: DetailCtx) => (c.includeBranches ? ["company_id", "child_of", c.companyId] : ["company_id", "=", c.companyId]);
const ctxOf = (c: DetailCtx) => ({ allowed_company_ids: [c.companyId], lang: "en_US", active_test: false });
const nameOf = (v: false | [number, string]) => (v ? v[1] : "");

/** Every stock location: its full name (as the exports show it) and how the company holds it, from Odoo's usage. */
export async function readLocations(c: DetailCtx): Promise<{ names: Map<number, string>; types: LocationTypes }> {
  const rows = trust(many(z.object({ id, complete_name: text, usage: text })), await c.client.executeKw("stock.location", "search_read", [[]], { fields: ["complete_name", "usage"], context: ctxOf(c) }), "locations");
  const names = new Map<number, string>(), types: LocationTypes = {};
  for (const r of rows) {
    names.set(r.id, r.complete_name);
    const t = usageType(r.usage);
    if (t && r.complete_name) types[r.complete_name] = t;
  }
  return { names, types };
}

/** Product category by product, for the ones in a page. */
async function categories(c: DetailCtx, ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const rows = trust(many(z.object({ id, categ_id: m2o })), await c.client.executeKw("product.product", "read", [[...new Set(ids)]], { fields: ["categ_id"], context: ctxOf(c) }), "products");
  return new Map(rows.map((r) => [r.id, nameOf(r.categ_id)]));
}

const salesDomain = (c: DetailCtx, from: string, to: string) => [
  ["parent_state", "=", "posted"], company(c), ["move_id.move_type", "in", ["out_invoice", "out_refund"]],
  c.major >= 16 ? ["display_type", "=", "product"] : ["exclude_from_invoice_tab", "=", false], ["date", ">=", from], ["date", "<=", to],
];

/** How many records a part has (for progress), and the first stock day (so the stock batch covers every month). */
export async function countPart(c: DetailCtx, part: Part, range: { from: string; to: string }): Promise<number> {
  const [model, domain] = part === "sales" ? ["account.move.line", salesDomain(c, range.from, range.to)]
    : part === "moves" ? ["stock.move.line", [["state", "=", "done"], company(c), ["date", "<=", `${range.to} 23:59:59`]]]
    : part === "valuation" ? ["stock.valuation.layer", [company(c), ["create_date", "<=", `${range.to} 23:59:59`]]]
    : ["stock.quant", [company(c), ["location_id.usage", "in", ["internal", "transit"]]]];
  return trust(z.number().int().min(0).max(100_000_000), await c.client.executeKw(model as string, "search_count", [domain], { context: ctxOf(c) }), "count");
}

export async function firstStockDay(c: DetailCtx): Promise<string | null> {
  const [m] = trust(many(z.object({ id, date: stamp })), await c.client.executeKw("stock.move.line", "search_read", [[["state", "=", "done"], company(c)]], { fields: ["date"], order: "date asc", limit: 1, context: ctxOf(c) }), "first move");
  const [l] = trust(many(z.object({ id, create_date: stamp })), await c.client.executeKw("stock.valuation.layer", "search_read", [[company(c)]], { fields: ["create_date"], order: "create_date asc", limit: 1, context: ctxOf(c) }), "first layer");
  const days = [m?.date, l?.create_date].filter((d): d is string => Boolean(d)).sort();
  return days[0] ?? null;
}

/** One page of sales lines: untaxed, company currency, credit notes negative, free lines (zero amount) kept. */
export async function salesPage(c: DetailCtx, range: { from: string; to: string }, offset: number): Promise<SalesLine[]> {
  const rows = trust(many(z.object({ id, date: stamp, move_id: m2o, partner_id: m2o, product_id: m2o, quantity: amount, balance: amount, name: text })),
    await c.client.executeKw("account.move.line", "search_read", [salesDomain(c, range.from, range.to)], { fields: ["date", "move_id", "partner_id", "product_id", "quantity", "balance", "name"], order: "date, id", limit: PAGE.sales, offset, context: ctxOf(c) }), "sales lines");
  const moveIds = [...new Set(rows.map((r) => (r.move_id ? r.move_id[0] : 0)).filter(Boolean))];
  const moves = moveIds.length ? trust(many(z.object({ id, name: text, invoice_user_id: m2o, move_type: text })), await c.client.executeKw("account.move", "read", [moveIds], { fields: ["name", "invoice_user_id", "move_type"], context: ctxOf(c) }), "invoices") : [];
  const byMove = new Map(moves.map((m) => [m.id, m]));
  const cats = await categories(c, rows.map((r) => (r.product_id ? r.product_id[0] : 0)).filter(Boolean));
  return rows.map((r) => {
    const mv = r.move_id ? byMove.get(r.move_id[0]) : undefined;
    const refund = mv?.move_type === "out_refund";
    const label = r.product_id ? r.product_id[1] : r.name.split(/\r?\n/)[0];
    const { category, product } = splitLabel(label);
    const amt = Math.round(-r.balance * 100) / 100 || 0;
    const doc = mv?.name || (r.move_id ? r.move_id[1] : "");
    return {
      day: r.date, period: r.date.slice(0, 7), doc, series: seriesOf(doc), customer: nameOf(r.partner_id) || NO_CUSTOMER,
      product, category: (r.product_id && cats.get(r.product_id[0])) || category, salesperson: mv ? nameOf(mv.invoice_user_id) : "",
      qty: r.quantity ? (refund ? -Math.abs(r.quantity) : Math.abs(r.quantity)) : r.quantity === 0 ? 0 : null, amount: amt, cost: null,
    };
  }).filter((l) => l.amount !== 0 || (l.qty ?? 0) !== 0);
}

export interface MoveRow { odoo_key: string; day: string; period: string; ref: string; kind: MoveKind; product: string; code: string; lot: string; from_loc: string; to_loc: string; qty: number; uom: string; partner: string }
export interface LayerRow { odoo_key: string; day: string; period: string; ref: string; kind: string; product: string; code: string; category: string; lot: string; qty: number; unit_value: number; value: number; partner: string; landed_ref: string }

/** One page of done stock moves, each with its kind from where the goods went. */
export async function movesPage(c: DetailCtx, to: string, offset: number, loc: { names: Map<number, string>; types: LocationTypes }, rentals: string | null): Promise<MoveRow[]> {
  const qtyField = c.major >= 17 ? "quantity" : "qty_done";
  const rows = trust(many(z.object({ id, date: stamp, reference: text, product_id: m2o, lot_id: m2o, location_id: m2o, location_dest_id: m2o, quantity: amount.optional(), qty_done: amount.optional(), product_uom_id: m2o, picking_partner_id: m2o.optional() })),
    await c.client.executeKw("stock.move.line", "search_read", [[["state", "=", "done"], company(c), ["date", "<=", `${to} 23:59:59`]]], { fields: ["date", "reference", "product_id", "lot_id", "location_id", "location_dest_id", qtyField, "product_uom_id", "picking_partner_id"], order: "id", limit: PAGE.stock, offset, context: ctxOf(c) }), "stock moves");
  return rows.map((r) => {
    const from = r.location_id ? loc.names.get(r.location_id[0]) ?? r.location_id[1] : "";
    const dest = r.location_dest_id ? loc.names.get(r.location_dest_id[0]) ?? r.location_dest_id[1] : "";
    const { code, product } = splitProduct(nameOf(r.product_id));
    return {
      odoo_key: String(r.id), day: r.date, period: r.date.slice(0, 7), ref: r.reference.slice(0, 120), kind: moveKind(from, dest, rentals, loc.types),
      product, code, lot: nameOf(r.lot_id), from_loc: from, to_loc: dest, qty: (c.major >= 17 ? r.quantity : r.qty_done) ?? 0, uom: nameOf(r.product_uom_id), partner: nameOf(r.picking_partner_id ?? false),
    };
  });
}

/** One page of valuation records: the month is the day of its journal entry when it has one (as Odoo's accounts book it). */
export async function layersPage(c: DetailCtx, to: string, offset: number, loc: { names: Map<number, string>; types: LocationTypes }, rentals: string | null): Promise<LayerRow[]> {
  const rows = trust(many(z.object({ id, create_date: stamp, product_id: m2o, quantity: amount, unit_cost: amount, value: amount, description: text, reference: text, stock_move_id: m2o, stock_landed_cost_id: m2o.optional(), account_move_id: m2o.optional() })),
    await c.client.executeKw("stock.valuation.layer", "search_read", [[company(c), ["create_date", "<=", `${to} 23:59:59`]]], { fields: ["create_date", "product_id", "quantity", "unit_cost", "value", "description", "reference", "stock_move_id", "stock_landed_cost_id", "account_move_id"], order: "id", limit: PAGE.stock, offset, context: ctxOf(c) }), "valuation records");
  const accIds = [...new Set(rows.map((r) => (r.account_move_id ? r.account_move_id[0] : 0)).filter(Boolean))];
  const booked = accIds.length ? new Map(trust(many(z.object({ id, date: stamp })), await c.client.executeKw("account.move", "read", [accIds], { fields: ["date"], context: ctxOf(c) }), "journal dates").map((m) => [m.id, m.date])) : new Map<number, string>();
  const moveIds = [...new Set(rows.map((r) => (r.stock_move_id ? r.stock_move_id[0] : 0)).filter(Boolean))];
  const moves = moveIds.length ? new Map(trust(many(z.object({ id, location_id: m2o, location_dest_id: m2o, partner_id: m2o.optional() })), await c.client.executeKw("stock.move", "read", [moveIds], { fields: ["location_id", "location_dest_id", "partner_id"], context: ctxOf(c) }), "moves").map((m) => [m.id, m])) : new Map();
  const cats = await categories(c, rows.map((r) => (r.product_id ? r.product_id[0] : 0)).filter(Boolean));
  return rows.map((r) => {
    const day = (r.account_move_id && booked.get(r.account_move_id[0])) || r.create_date;
    const mv = r.stock_move_id ? moves.get(r.stock_move_id[0]) : undefined;
    const kindOfMove = mv ? moveKind(mv.location_id ? loc.names.get(mv.location_id[0]) ?? mv.location_id[1] : "", mv.location_dest_id ? loc.names.get(mv.location_dest_id[0]) ?? mv.location_dest_id[1] : "", rentals, loc.types) : undefined;
    const { code, product } = splitProduct(nameOf(r.product_id));
    return {
      odoo_key: String(r.id), day, period: day.slice(0, 7), ref: r.reference.slice(0, 120), kind: r.stock_landed_cost_id ? "landed_cost" : layerKind(r.reference, r.description, r.quantity, kindOfMove),
      product, code, category: (r.product_id && cats.get(r.product_id[0])) || "", lot: "", qty: r.quantity, unit_value: r.unit_cost, value: r.value,
      partner: mv ? nameOf(mv.partner_id ?? false) : "", landed_ref: r.stock_landed_cost_id ? r.stock_landed_cost_id[1].slice(0, 120) : "",
    };
  });
}

/** Stock on hand now, in the company's own and transit locations. */
export async function onHand(c: DetailCtx, loc: { names: Map<number, string> }): Promise<{ product: string; code: string; location: string; lot: string; qty: number; value: number | null }[]> {
  const out: { product: string; code: string; location: string; lot: string; qty: number; value: number | null }[] = [];
  for (let offset = 0; offset < 200_000; offset += PAGE.stock) {
    const rows = trust(many(z.object({ id, product_id: m2o, location_id: m2o, lot_id: m2o, quantity: amount, value: amount })),
      await c.client.executeKw("stock.quant", "search_read", [[company(c), ["location_id.usage", "in", ["internal", "transit"]]]], { fields: ["product_id", "location_id", "lot_id", "quantity", "value"], order: "id", limit: PAGE.stock, offset, context: ctxOf(c) }), "stock on hand");
    for (const r of rows) {
      const { code, product } = splitProduct(nameOf(r.product_id));
      out.push({ product, code, location: r.location_id ? loc.names.get(r.location_id[0]) ?? r.location_id[1] : "", lot: nameOf(r.lot_id), qty: r.quantity, value: r.value });
    }
    if (rows.length < PAGE.stock) return out;
  }
  throw new OdooError("More stock-on-hand records than a sync reads. Upload the Stock export instead.");
}

/** A synced account the journal lines are read for: revenue and cost accounts (sales, expenses) and stock accounts. */
export interface LedgerAccount { odoo_id: number; code: string; name: string; cls: ClassKey }
const ledgerAccounts = (accts: LedgerAccount[]) => accts.filter((a) => a.cls === "revenue" || a.cls === "inventory" || EXPENSE_CLASSES.has(a.cls));
const ledgerDomain = (c: DetailCtx, accts: LedgerAccount[], range: { from: string; to: string }) => [
  ["parent_state", "=", "posted"], company(c), ["date", ">=", range.from], ["date", "<=", range.to], ["account_id", "in", ledgerAccounts(accts).map((a) => a.odoo_id)],
];

export async function countLedger(c: DetailCtx, accts: LedgerAccount[], range: { from: string; to: string }): Promise<number> {
  if (!ledgerAccounts(accts).length) return 0;
  return trust(z.number().int().min(0).max(100_000_000), await c.client.executeKw("account.move.line", "search_count", [ledgerDomain(c, accts, range)], { context: ctxOf(c) }), "journal line count");
}

/**
 * One page of the posted journal lines on revenue, cost and stock accounts, as the General Ledger upload reads them:
 * sales lines from revenue, expense lines from costs, stock postings from the stock accounts.
 */
export async function ledgerPage(c: DetailCtx, accts: LedgerAccount[], range: { from: string; to: string }, offset: number, limit: number = PAGE.sales): Promise<{ sales: SalesLine[]; expenses: ExpenseLine[]; stock: StockLedgerLine[]; read: number }> {
  const use = ledgerAccounts(accts);
  if (!use.length) return { sales: [], expenses: [], stock: [], read: 0 };
  const page = trust(DetailLines, await c.client.executeKw("account.move.line", "search_read", [ledgerDomain(c, accts, range)], { fields: ["account_id", "date", "move_id", "partner_id", "name", "balance"], limit, offset, order: "id", context: ctxOf(c) }), "journal items");
  const entries = new Map<number, LedgerEntry[]>();
  for (const l of page) {
    if (!l.account_id || !l.balance) continue;
    const list = entries.get(l.account_id[0]) ?? [];
    list.push({ day: l.date.slice(0, 10), period: l.date.slice(0, 7), ref: l.move_id ? l.move_id[1] : "", label: (l.name || "").trim(), partner: l.partner_id ? l.partner_id[1] : "", amount: l.balance });
    entries.set(l.account_id[0], list);
  }
  const lines = (pick: (a: LedgerAccount) => boolean) => use.filter(pick).map((a) => ({ code: a.code, name: a.name, cls: a.cls, excluded: false, entries: entries.get(a.odoo_id) ?? [] }));
  const core = lines((a) => a.cls !== "inventory");
  return { sales: salesFromLedger(core), expenses: expensesFromLedger(core), stock: stockFromLedger(lines((a) => a.cls === "inventory")), read: page.length };
}

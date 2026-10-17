import { arRx, cleanNum, detectDateOrder, normAr, parseDay, type Cell, type DateOrder } from "./parse";
import { str, type Grid, type LedgerEntry } from "./extract";
import { findHeader, type ColumnMap, type SavedMapping } from "./odoo-templates";

/**
 * The Inventory module's sheets, as Odoo 18 exports them (list view, Export; English or Arabic headings, field labels or the
 * technical names an import-compatible export uses):
 *  - Stock valuation (stock.valuation.layer): the money detail, one row per FIFO layer, landed costs included;
 *  - Moves history (stock.move.line, done): quantities and where they went;
 *  - Stock on hand (stock.quant): the closing quantities at the export date;
 *  - Products: category and cost per product (optional).
 * Values are Odoo's own (company currency, incoming positive, outgoing negative); nothing is recomputed here. Each row keeps
 * Odoo's record ID as its key, or a fingerprint of the fields that identify it when the export has no ID column.
 */
export type MoveKind = "receipt" | "delivery" | "customer_return" | "supplier_return" | "internal" | "rental_out" | "rental_back" | "adjustment" | "scrap" | "manufacturing";
export type LayerKind = "receipt" | "delivery" | "customer_return" | "supplier_return" | "landed_cost" | "adjustment" | "scrap" | "revaluation" | "other";

export interface StockLayer { key: string; updated?: string; day: string; period: string; ref: string; kind: LayerKind; product: string; code: string; category: string; lot: string; qty: number; unitValue: number; value: number; partner: string; landedRef: string; src?: { sheet: string; row: number } }
export interface StockMove { key: string; updated?: string; day: string; period: string; ref: string; kind: MoveKind; product: string; code: string; lot: string; from: string; to: string; qty: number; uom: string; partner: string; src?: { sheet: string; row: number } }
export interface OnHand { asOf: string; product: string; code: string; location: string; lot: string; qty: number; value: number | null }
export interface ProductRow { code: string; name: string; category: string; cost: number | null; type: string }

/** A row that holds data but cannot be saved as it is: its row in the sheet, and why. */
export interface RowIssue { line: number; message: string }
/** What a reader found: the records, the rows it could not read, and lines that are not records (blank, totals, not done). */
export interface ReadNotes { issues: RowIssue[]; skipped: number }

const header = (g: Grid, saved?: SavedMapping | null) => findHeader(g, saved);
const lineOf = (g: Grid, i: number) => i + 1 + (g.origin?.r ?? 0);

/** "[P1] Mask" → code P1, product Mask (Odoo shows the internal reference in brackets). */
export function splitProduct(label: string, code = ""): { code: string; product: string } {
  const first = label.split(/\r?\n/)[0].trim();
  const m = first.match(/^\[([^\]]+)\]\s*(.*)$/);
  return m ? { code: code || m[1].trim(), product: m[2].trim() } : { code, product: first };
}

/**
 * One product, as Odoo shows it: "[internal reference] name". Many companies put a product group in the internal reference
 * ("[Device] …", shared by hundreds of products), so a product is never identified by its reference alone.
 */
export const productKey = (code: string, product: string) => (code ? `[${code}] ${product}` : product);

/** A short, stable key from the fields that identify a row (FNV-1a, two 32-bit halves). */
export function fingerprint(parts: (string | number)[]): string {
  const s = parts.map((p) => (typeof p === "number" ? String(Math.round(p * 10000) / 10000) : p.trim())).join("|");
  let a = 0x811c9dc5, b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return `fp:${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}

const RENTAL = arRx(/rental|تأجير|إيجار|ايجار/i);
const VENDOR = arRx(/vendor|supplier|موردين|الموردون|المورد/i);
const CUSTOMER = arRx(/customer|عملاء|العملاء|العميل/i);
const ADJUST = arRx(/inventory adjustment|inventory loss|تسوية المخزون|تسوية|جرد/i);
const SCRAP = arRx(/scrap|خردة|هالك|تالف/i);
const PRODUCTION = arRx(/production|إنتاج|انتاج|التصنيع/i);

const TRANSIT = arRx(/transit|عبور|ترانزيت/i);

/**
 * Where a location stands:
 *  - warehouse: the company's own stock (shelves, branches, the rental fleet's warehouse) — what Odoo counts as on hand;
 *  - rental_out: with customers on rental (Odoo's "Virtual Locations/Rental"): still the company's, still valued;
 *  - transit: between the company's own warehouses: still the company's, still valued, not on hand;
 *  - partner: suppliers and customers; virtual: adjustments, scrap, production.
 * rentalLocations are the locations goods go to when rented out (see rentalLocationsOf).
 */
export type LocationClass = "warehouse" | "rental_out" | "transit" | "partner" | "virtual";
export function locationClass(loc: string, rentalLocations: readonly string[] = []): LocationClass {
  const l = normAr(loc);
  if (!l) return "virtual";
  if (rentalLocations.some((r) => normAr(r).toLowerCase() === l.toLowerCase())) return "rental_out";
  if (VENDOR.test(l) || CUSTOMER.test(l) || /^partner/i.test(l)) return "partner";
  if (/^virtual/i.test(l) || ADJUST.test(l) || SCRAP.test(l) || PRODUCTION.test(l)) return "virtual";
  if (TRANSIT.test(l)) return "transit";
  return "warehouse";
}

/** A location of the company's own (a warehouse, the rental fleet's warehouse, or in transit between them). */
export const isInternalLocation = (loc: string) => { const c = locationClass(loc); return c === "warehouse" || c === "transit"; };

/**
 * The locations rented goods go out to, from the locations the moves use: the person's choice when made; otherwise Odoo's
 * virtual rental location ("Virtual Locations/Rental"); only when there is none, any location named for rental.
 * A warehouse named for rental ("Cai/Rental/Cairo rental") holds the rental fleet: moving stock into it is not renting out.
 */
export function rentalLocationsOf(locations: Iterable<string>, chosen?: string | null): string[] {
  if (chosen) return [chosen];
  const all = [...new Set(locations)].filter((l) => RENTAL.test(normAr(l)));
  const virtual = all.filter((l) => /^virtual/i.test(normAr(l)));
  return virtual.length ? virtual : all;
}

/** What a move did, from its source and destination locations (Odoo's partner and virtual locations). */
export function moveKind(from: string, to: string, rentalLocations: string | readonly string[] | null = null): MoveKind {
  const rentals = rentalLocations === null ? rentalLocationsOf([from, to]) : typeof rentalLocations === "string" ? [rentalLocations] : rentalLocations;
  const f = normAr(from), t = normAr(to);
  if (VENDOR.test(f)) return "receipt";
  if (VENDOR.test(t)) return "supplier_return";
  if (CUSTOMER.test(t)) return "delivery";
  if (CUSTOMER.test(f)) return "customer_return";
  if (ADJUST.test(f) || ADJUST.test(t)) return "adjustment";
  if (SCRAP.test(f) || SCRAP.test(t)) return "scrap";
  if (PRODUCTION.test(f) || PRODUCTION.test(t)) return "manufacturing";
  const rf = locationClass(from, rentals) === "rental_out", rt = locationClass(to, rentals) === "rental_out";
  if (rt && !rf) return "rental_out";
  if (rf && !rt) return "rental_back";
  return "internal";
}

const LANDED = /landed cost|^LC\/|\bLC\/\d|التكلفة الواصلة|التكاليف الواصلة/i;
const REVALUE = arRx(/revaluation|إعادة تقييم|اعادة تقييم/i);
const ADJ_DESC = arRx(/inventory adjust|quantity updated|product quantity|تسوية|جرد/i);
const FROM_MOVE: Partial<Record<MoveKind, LayerKind>> = { receipt: "receipt", delivery: "delivery", customer_return: "customer_return", supplier_return: "supplier_return", adjustment: "adjustment", scrap: "scrap" };

/** What a valuation layer is: from its move when loaded, else from its reference, description and the sign of the quantity. */
export function layerKind(ref: string, description: string, qty: number, move?: MoveKind): LayerKind {
  if (LANDED.test(ref) || LANDED.test(description)) return "landed_cost";
  if (REVALUE.test(normAr(description))) return "revaluation";
  if (move) return FROM_MOVE[move] ?? "other";
  const R = ref.toUpperCase();
  if (/\/IN\//.test(R)) return qty >= 0 ? "receipt" : "supplier_return";
  if (/\/OUT\//.test(R)) return qty <= 0 ? "delivery" : "customer_return";
  if (/\/RET|RETURN/.test(R)) return qty > 0 ? "customer_return" : "supplier_return";
  if (/(^|\/)SP\//.test(R) || SCRAP.test(normAr(description))) return "scrap";
  if (ADJ_DESC.test(normAr(description)) || ADJ_DESC.test(ref) || /^INV:/i.test(ref)) return "adjustment";
  return "other";
}

/** The kinds a move can give its valuation row (a rental or internal move carries no value of its own). */
const VALUED_MOVE: MoveKind[] = ["adjustment", "scrap", "supplier_return", "customer_return", "receipt", "delivery"];

/**
 * Each valuation row takes its kind from its move (same reference and product): where the goods really went decides
 * whether it is a receipt, a delivery, a return to a supplier or an adjustment, whatever its reference is called.
 * Landed costs and revaluations keep their kind; a row with no move keeps the kind read from its reference.
 */
export function classifyLayers<T extends { ref: string; code: string; product: string; kind: LayerKind }>(layers: T[], moves: { ref: string; code: string; product: string; kind: MoveKind }[]): T[] {
  const byDoc = new Map<string, Set<MoveKind>>();
  for (const m of moves) {
    if (!m.ref) continue;
    const k = `${m.ref}\u0001${productKey(m.code, m.product)}`;
    const set = byDoc.get(k) ?? new Set<MoveKind>();
    set.add(m.kind); byDoc.set(k, set);
  }
  return layers.map((l) => {
    if (l.kind === "landed_cost" || l.kind === "revaluation" || !l.ref) return l;
    const kinds = byDoc.get(`${l.ref}\u0001${productKey(l.code, l.product)}`);
    const k = kinds && VALUED_MOVE.find((x) => kinds.has(x));
    return k ? { ...l, kind: FROM_MOVE[k]! } : l;
  });
}

const cell = (row: Cell[], c: number | undefined) => (c === undefined ? "" : str(row[c]));
const DONE = arRx(/^(done|منتهي|منتهية|تم|مكتمل)$/i);

/** Data rows under the heading, with a readable day; the date order (dd/mm or mm/dd) is taken from the column itself. */
function* dataRows(g: Grid, h: { r: number; col: ColumnMap }) {
  const dc = h.col.date;
  const order: DateOrder = (dc === undefined ? null : detectDateOrder(g.rows.slice(h.r + 1).map((x) => x?.[dc])).order) ?? "dmy";
  for (let i = h.r + 1; i < g.rows.length; i++) {
    const row = g.rows[i] ?? [];
    if (!row.some((v) => str(v) !== "")) continue;
    const day = dc === undefined ? null : parseDay(row[dc] ?? null, order);
    yield { i, row, day };
  }
}

/**
 * Fingerprint keys for rows with no Odoo ID: identical rows in one export are separate records (two equal deliveries),
 * so the nth copy gets "#n". The same file read again gives the same keys.
 */
function fingerprints() {
  const seen = new Map<string, number>();
  return (parts: (string | number)[]) => {
    const fp = fingerprint(parts), n = (seen.get(fp) ?? 0) + 1;
    seen.set(fp, n);
    return n === 1 ? fp : `${fp}#${n}`;
  };
}

/** Headings naming a customer or supplier: a sales or purchase list, never a valuation export (layers have no partner). */
const PARTY_HEADING = /(customer|vendor|supplier|client|partner|عميل|العميل|مورد|المورد|شريك|الشريك)/i;

/** A number cell: empty is 0; text that is not a number is a problem (never read as 0). */
const numOf = (v: Cell): number | null => (v === null || v === undefined || (typeof v === "string" && !v.trim()) ? 0 : cleanNum(v));
const pad = (n: number) => String(n).padStart(2, "0");
/** Odoo's "Last Updated on" as "YYYY-MM-DD HH:MM:SS" (as exported, the person's time zone); "" when empty, null when unreadable. */
export function parseStamp(v: Cell): string | null {
  if (v === null || v === undefined || v === "") return "";
  if (v instanceof Date) return isNaN(v.getTime()) ? null : `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())} ${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`;
  const m = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4] ?? "00"}:${m[5] ?? "00"}:${m[6] ?? "00"}` : null;
}

/** The problems that stop a row from being saved: an unreadable date, no product, a number that is not a number. */
function rowProblems(row: Cell[], c: ColumnMap, day: string | null, need: ("qty" | "value")[]): { problems: string[]; nums: Record<string, number>; updated: string } {
  const problems: string[] = [];
  if (!day) problems.push(c.date !== undefined && str(row[c.date]) ? `Date is not readable: "${str(row[c.date])}"` : "No date");
  if (!cell(row, c.product)) problems.push("No product");
  const nums: Record<string, number> = {};
  for (const k of need) {
    const n = numOf(row[c[k]!] ?? null);
    if (n === null) problems.push(`${k === "qty" ? "Quantity" : "Value"} is not a number: "${str(row[c[k]!])}"`);
    else nums[k] = n;
  }
  const updated = c.updated === undefined ? "" : parseStamp(row[c.updated] ?? null);
  if (updated === null) problems.push(`Last updated on is not readable: "${str(row[c.updated!])}"`);
  return { problems, nums, updated: updated ?? "" };
}

export function readStockValuation(g: Grid, saved?: SavedMapping | null): ({ layers: StockLayer[]; withIds: boolean } & ReadNotes) | null {
  const h = header(g, saved);
  if (!h) return null;
  const c = h.col;
  if (c.product === undefined || c.qty === undefined || c.value === undefined || c.date === undefined || (c.ref === undefined && c.desc === undefined)) return null;
  if (c.from !== undefined || c.to !== undefined || c.location !== undefined) return null;
  if ((g.rows[h.r] ?? []).some((v) => PARTY_HEADING.test(normAr(str(v))))) return null;
  const withIds = c.id !== undefined;
  const fp = fingerprints();
  const layers: StockLayer[] = [];
  const issues: RowIssue[] = [];
  let skipped = 0;
  for (const { i, row, day: rowDay } of dataRows(g, h)) {
    // A line with neither a date nor a product is a group heading or a total, not a record.
    if (!rowDay && !cell(row, c.product)) { skipped++; continue; }
    const { problems, nums, updated } = rowProblems(row, c, rowDay, ["qty", "value"]);
    if (problems.length) { issues.push({ line: lineOf(g, i), message: problems.join("; ") }); continue; }
    let day = rowDay!;
    const ref = cell(row, c.ref), desc = cell(row, c.desc), qty = nums.qty, value = nums.value;
    // Odoo marks a back-dated row "[Accounted on 2026-01-17]": its journal entry, and so the accounts, carry that date.
    const accounted = ref.match(/\[Accounted on (\d{4}-\d{2}-\d{2})\]/i)?.[1];
    if (accounted) day = accounted;
    const { code, product } = splitProduct(cell(row, c.product), cell(row, c.code));
    const lot = cell(row, c.lot);
    // A value with no quantity changes what goods cost, not how many: on a receipt it is a landed cost, otherwise a revaluation.
    const kind = !qty && value ? (/\/IN\//i.test(ref) || LANDED.test(ref + " " + desc) ? "landed_cost" : "revaluation") : layerKind(ref, desc + " " + cell(row, c.landed), qty);
    const landedRef = kind === "landed_cost" ? (cell(row, c.landed) || (ref.match(/LC\/[^\s]+/i)?.[0] ?? desc.match(/LC\/[^\s]+/i)?.[0] ?? ref)) : "";
    const id = cell(row, c.id);
    const unitValue = c.unitValue === undefined ? null : numOf(row[c.unitValue] ?? null);
    layers.push({
      key: withIds && id ? id : fp([day, ref, code || product, lot, qty, value]), ...(updated ? { updated } : {}),
      day, period: day.slice(0, 7), ref, kind, product, code, category: cell(row, c.category), lot, qty,
      unitValue: unitValue ?? (qty ? Math.round((value / qty) * 10000) / 10000 : 0),
      value, partner: cell(row, c.partner), landedRef, src: { sheet: g.name, row: i },
    });
  }
  return layers.length || issues.length ? { layers, withIds, issues, skipped } : null;
}

export function readStockMoves(g: Grid, rentalLocation?: string | null, saved?: SavedMapping | null): ({ moves: StockMove[]; withIds: boolean } & ReadNotes) | null {
  const h = header(g, saved);
  if (!h) return null;
  const c = h.col;
  if (c.product === undefined || c.from === undefined || c.to === undefined || c.qty === undefined || c.date === undefined) return null;
  const withIds = c.id !== undefined;
  const fp = fingerprints();
  const issues: RowIssue[] = [];
  let skipped = 0;
  const done: { i: number; row: Cell[]; day: string; qty: number; updated: string }[] = [];
  for (const { i, row, day } of dataRows(g, h)) {
    if (!day && !cell(row, c.product)) { skipped++; continue; }
    // Only done moves moved goods; draft, waiting and cancelled ones are left out.
    if (c.status !== undefined && !DONE.test(normAr(cell(row, c.status)))) { skipped++; continue; }
    const { problems, nums, updated } = rowProblems(row, c, day, ["qty"]);
    if (!cell(row, c.from) || !cell(row, c.to)) problems.push("No source or destination location");
    if (problems.length) { issues.push({ line: lineOf(g, i), message: problems.join("; ") }); continue; }
    done.push({ i, row, day: day!, qty: nums.qty, updated });
  }
  // Which locations are "out on rental" is decided from every location the export uses, before any move is classified.
  const rentals = rentalLocationsOf(done.flatMap(({ row }) => [cell(row, c.from), cell(row, c.to)]), rentalLocation);
  const moves: StockMove[] = done.map(({ i, row, day, qty, updated }) => {
    const ref = cell(row, c.ref), from = cell(row, c.from), to = cell(row, c.to), lot = cell(row, c.lot);
    const { code, product } = splitProduct(cell(row, c.product), cell(row, c.code));
    const id = cell(row, c.id);
    return {
      key: withIds && id ? id : fp([day, ref, code || product, lot, from, to, qty]), ...(updated ? { updated } : {}),
      day, period: day.slice(0, 7), ref, kind: moveKind(from, to, rentals), product, code, lot, from, to, qty,
      uom: cell(row, c.uom), partner: cell(row, c.partner), src: { sheet: g.name, row: i },
    };
  });
  return moves.length || issues.length ? { moves, withIds, issues, skipped } : null;
}

/** Headings of Odoo's product list that give what is on hand in the warehouses (product.product: "Quantity On Hand"). */
const ON_HAND_HEADING = arRx(/^(quantity on hand|qty_available|on hand quantity|الكمية في اليد|الكمية المتاحة)$/i);

export function readStockOnHand(g: Grid, asOf: string, saved?: SavedMapping | null): OnHand[] | null {
  const r = readOnHandSheet(g, asOf, saved);
  return r?.rows.length ? r.rows : null;
}

/** Stock on hand with the rows that could not be read. */
export function readOnHandSheet(g: Grid, asOf: string, saved?: SavedMapping | null): ({ rows: OnHand[] } & ReadNotes) | null {
  const h = header(g, saved);
  if (!h) return null;
  const c = h.col;
  // Odoo shows a product as "[internal reference] name" (Display Name) or, in some layouts, as Name and Internal Reference
  // in two columns: both give the same product.
  const productCol = c.product ?? c.name;
  if (productCol === undefined || c.qty === undefined || c.date !== undefined) return null;
  // Without a location column, only Odoo's product list counts: its "Quantity On Hand" is the total in the warehouses
  // (location "" = all of them), and its "Total Value" what that stock is worth.
  if (c.location === undefined && !(g.rows[h.r] ?? []).some((v) => ON_HAND_HEADING.test(normAr(str(v))))) return null;
  const out: OnHand[] = [];
  const issues: RowIssue[] = [];
  let skipped = 0;
  for (const { i, row } of dataRows(g, h)) {
    if (!cell(row, productCol)) { skipped++; continue; }
    const qty = numOf(row[c.qty] ?? null), value = c.value === undefined ? null : numOf(row[c.value] ?? null);
    if (qty === null || (c.value !== undefined && value === null)) {
      issues.push({ line: lineOf(g, i), message: qty === null ? `Quantity is not a number: "${str(row[c.qty])}"` : `Value is not a number: "${str(row[c.value!])}"` });
      continue;
    }
    // Never Cost × quantity: without Total Value the stock is valued from its valuation layers.
    const { code, product } = splitProduct(cell(row, productCol), cell(row, c.code));
    out.push({ asOf, product, code, location: cell(row, c.location), lot: cell(row, c.lot), qty, value: c.value === undefined || str(row[c.value]) === "" ? null : value });
  }
  return out.length || issues.length ? { rows: out, issues, skipped } : null;
}

/** Headings of a document list (invoices, bills, orders, journal items), never of a products list. */
const DOCUMENT_HEADING = /(date|تاريخ|number|^ref(erence)?$|رقم|vendor|customer|partner|supplier|مورد|عميل|شريك|account|حساب|total|amount|untaxed|balance|debit|credit|الإجمالي|المبلغ|مدين|دائن)/i;

export function readProducts(g: Grid, saved?: SavedMapping | null): ProductRow[] | null {
  const h = header(g, saved);
  if (!h) return null;
  const c = h.col;
  const nameCol = c.name ?? c.product;
  if (nameCol === undefined || c.category === undefined || c.qty !== undefined || c.date !== undefined) return null;
  // "Internal Reference" is a products-list heading; any other document heading means this is a list of transactions.
  if ((g.rows[h.r] ?? []).some((v, i) => i !== c.code && DOCUMENT_HEADING.test(normAr(str(v))))) return null;
  const out: ProductRow[] = [];
  for (const { row } of dataRows(g, h)) {
    const label = cell(row, nameCol);
    if (!label) continue;
    const { code, product } = splitProduct(label, cell(row, c.code));
    out.push({ code, name: product, category: cell(row, c.category), cost: c.cost === undefined ? null : cleanNum(row[c.cost] ?? null), type: cell(row, c.type) });
  }
  return out.length ? out : null;
}

/** The months a set of rows covers, in order. */
export const inventoryPeriods = (rows: { period: string }[]) => [...new Set(rows.map((r) => r.period))].sort();

/** A General Ledger entry on a stock account (debit positive): the ledger side of the Inventory tie-outs, by reference. */
export interface StockLedgerLine { day: string; period: string; ref: string; account: string; amount: number }

/**
 * The document a stock entry belongs to. Odoo posts each valuation layer as a stock journal entry (STJ/…) labelled
 * "<layer reference> - <product>", so the label's first part is the reference the valuation export carries (WH/OUT/…,
 * LC/…, "Quantity Updated-…"). Other entries keep their own reference.
 */
const ledgerDoc = (ref: string, label: string) => {
  const first = label.split(" - ")[0].trim();
  return first && first !== ref && (first.includes("/") || ADJ_DESC.test(normAr(first))) ? first : ref;
};

/** Every entry on the accounts mapped to Inventory, from a General Ledger upload or the Odoo connection. */
export function stockFromLedger(lines: { code: string; name: string; cls: string | null; excluded: boolean; system?: boolean; entries?: LedgerEntry[] }[]): StockLedgerLine[] {
  const out: StockLedgerLine[] = [];
  for (const l of lines) {
    if (l.excluded || l.system || l.cls !== "inventory" || !l.entries) continue;
    const account = [l.code, l.name].filter(Boolean).join(" ");
    for (const e of l.entries) if (e.amount) out.push({ day: e.day, period: e.period, ref: ledgerDoc(e.ref, e.label ?? ""), account, amount: Math.round(e.amount * 100) / 100 });
  }
  return out;
}

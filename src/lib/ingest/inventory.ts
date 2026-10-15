import { arRx, cleanNum, detectDateOrder, normAr, parseDay, type Cell, type DateOrder } from "./parse";
import { str, type Grid, type LedgerEntry } from "./extract";

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

export interface StockLayer { key: string; day: string; period: string; ref: string; kind: LayerKind; product: string; code: string; category: string; lot: string; qty: number; unitValue: number; value: number; partner: string; landedRef: string; src?: { sheet: string; row: number } }
export interface StockMove { key: string; day: string; period: string; ref: string; kind: MoveKind; product: string; code: string; lot: string; from: string; to: string; qty: number; uom: string; partner: string; src?: { sheet: string; row: number } }
export interface OnHand { asOf: string; product: string; code: string; location: string; lot: string; qty: number; value: number | null }
export interface ProductRow { code: string; name: string; category: string; cost: number | null; type: string }

type Field = "id" | "date" | "ref" | "product" | "code" | "name" | "category" | "lot" | "qty" | "unitValue" | "value" | "desc" | "landed" | "from" | "to" | "location" | "status" | "partner" | "uom" | "cost" | "type";
const FIELDS: [Field, RegExp][] = [
  ["id", arRx(/^(id|external id|المعرف|المعرّف|المعرف الخارجي|معرف خارجي)$/i)],
  ["date", arRx(/^(date|date done|create date|create_date|created on|date_done|accounting date|التاريخ|تاريخ|تاريخ الإنشاء)$/i)],
  ["ref", arRx(/^(reference|ref|stock move|stock_move_id|move|picking_id|transfer|المرجع|مرجع|حركة المخزون|التحويل)$/i)],
  ["product", arRx(/^(product|product_id|display name|display_name|المنتج|الصنف|اسم العرض)$/i)],
  ["code", arRx(/^(internal reference|default_code|product\/internal reference|المرجع الداخلي|كود الصنف)$/i)],
  ["name", arRx(/^(name|product name|الاسم|اسم المنتج|اسم الصنف)$/i)],
  ["category", arRx(/^(product category|category|categ_id|فئة المنتج|الفئة)$/i)],
  ["lot", arRx(/^(lot\/serial number|lot\/serial numbers|lot|lot_id|lot_ids|serial number|رقم الدفعة\/الرقم التسلسلي|رقم التشغيلة|الرقم التسلسلي|الدفعة)$/i)],
  ["qty", arRx(/^(quantity|qty|quantity done|qty_done|product_qty|on hand quantity|quantity on hand|inventory_quantity|الكمية|الكمية المنتهية|الكمية في اليد|الكمية الفعلية|الكمية المتاحة)$/i)],
  ["unitValue", arRx(/^(unit value|unit cost|unit_cost|قيمة الوحدة|تكلفة الوحدة)$/i)],
  ["value", arRx(/^(total value|value|القيمة الإجمالية|القيمة)$/i)],
  ["desc", arRx(/^(description|الوصف)$/i)],
  ["landed", arRx(/^(landed cost|landed costs|stock_landed_cost_id|التكلفة الواصلة|التكاليف الواصلة)$/i)],
  ["from", arRx(/^(from|source location|location_id|من|الموقع المصدر|من موقع)$/i)],
  ["to", arRx(/^(to|destination location|location_dest_id|إلى|الى|الموقع الوجهة|إلى موقع)$/i)],
  ["location", arRx(/^(location|الموقع)$/i)],
  ["status", arRx(/^(status|state|الحالة)$/i)],
  ["partner", arRx(/^(partner|contact|partner_id|الشريك|جهة الاتصال)$/i)],
  ["uom", arRx(/^(unit of measure|uom|product_uom_id|وحدة القياس)$/i)],
  ["cost", arRx(/^(cost|standard price|standard_price|التكلفة)$/i)],
  ["type", arRx(/^(product type|type|detailed_type|نوع المنتج)$/i)],
];
const fieldOf = (h: string): Field | null => {
  const t = normAr(h.replace(/\s*\*\s*$/, "").replace(/\s+/g, " ").trim());
  return FIELDS.find(([, rx]) => rx.test(t))?.[0] ?? null;
};

/** The heading row (first 15 rows) and the column of each field it names. */
function header(g: Grid): { r: number; col: Partial<Record<Field, number>> } | null {
  for (let r = 0; r < Math.min(g.rows.length, 15); r++) {
    const col: Partial<Record<Field, number>> = {};
    (g.rows[r] ?? []).forEach((v, c) => { const f = fieldOf(str(v)); if (f && col[f] === undefined) col[f] = c; });
    if (col.product !== undefined || col.name !== undefined) return { r, col };
  }
  return null;
}

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

const num = (v: Cell) => cleanNum(v) ?? 0;
const cell = (row: Cell[], c: number | undefined) => (c === undefined ? "" : str(row[c]));
const DONE = arRx(/^(done|منتهي|منتهية|تم|مكتمل)$/i);

/** Data rows under the heading, with a readable day; the date order (dd/mm or mm/dd) is taken from the column itself. */
function* dataRows(g: Grid, h: { r: number; col: Partial<Record<Field, number>> }) {
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

export function readStockValuation(g: Grid): { layers: StockLayer[]; withIds: boolean } | null {
  const h = header(g);
  if (!h) return null;
  const c = h.col;
  if (c.product === undefined || c.qty === undefined || c.value === undefined || (c.ref === undefined && c.desc === undefined)) return null;
  if (c.from !== undefined || c.to !== undefined || c.location !== undefined) return null;
  if ((g.rows[h.r] ?? []).some((v) => PARTY_HEADING.test(normAr(str(v))))) return null;
  const withIds = c.id !== undefined;
  const fp = fingerprints();
  const layers: StockLayer[] = [];
  for (const { i, row, day: rowDay } of dataRows(g, h)) {
    let day = rowDay;
    if (!day || !cell(row, c.product)) continue;
    const ref = cell(row, c.ref), desc = cell(row, c.desc), qty = num(row[c.qty]), value = num(row[c.value]);
    // Odoo marks a back-dated row "[Accounted on 2026-01-17]": its journal entry, and so the accounts, carry that date.
    const accounted = ref.match(/\[Accounted on (\d{4}-\d{2}-\d{2})\]/i)?.[1];
    if (accounted) day = accounted;
    const { code, product } = splitProduct(cell(row, c.product), cell(row, c.code));
    const lot = cell(row, c.lot);
    // A value with no quantity changes what goods cost, not how many: on a receipt it is a landed cost, otherwise a revaluation.
    const kind = !qty && value ? (/\/IN\//i.test(ref) || LANDED.test(ref + " " + desc) ? "landed_cost" : "revaluation") : layerKind(ref, desc + " " + cell(row, c.landed), qty);
    const landedRef = kind === "landed_cost" ? (cell(row, c.landed) || (ref.match(/LC\/[^\s]+/i)?.[0] ?? desc.match(/LC\/[^\s]+/i)?.[0] ?? ref)) : "";
    const id = cell(row, c.id);
    layers.push({
      key: withIds && id ? id : fp([day, ref, code || product, lot, qty, value]),
      day, period: day.slice(0, 7), ref, kind, product, code, category: cell(row, c.category), lot, qty,
      unitValue: c.unitValue === undefined ? (qty ? Math.round((value / qty) * 10000) / 10000 : 0) : num(row[c.unitValue]),
      value, partner: cell(row, c.partner), landedRef, src: { sheet: g.name, row: i },
    });
  }
  return layers.length ? { layers, withIds } : null;
}

export function readStockMoves(g: Grid, rentalLocation?: string | null): { moves: StockMove[]; withIds: boolean } | null {
  const h = header(g);
  if (!h) return null;
  const c = h.col;
  if (c.product === undefined || c.from === undefined || c.to === undefined || c.qty === undefined) return null;
  const withIds = c.id !== undefined;
  const fp = fingerprints();
  const done: { i: number; row: Cell[]; day: string }[] = [];
  for (const { i, row, day } of dataRows(g, h)) {
    if (!day || !cell(row, c.product)) continue;
    if (c.status !== undefined && !DONE.test(normAr(cell(row, c.status)))) continue;
    done.push({ i, row, day });
  }
  // Which locations are "out on rental" is decided from every location the export uses, before any move is classified.
  const rentals = rentalLocationsOf(done.flatMap(({ row }) => [cell(row, c.from), cell(row, c.to)]), rentalLocation);
  const moves: StockMove[] = done.map(({ i, row, day }) => {
    const ref = cell(row, c.ref), from = cell(row, c.from), to = cell(row, c.to), qty = num(row[c.qty!]), lot = cell(row, c.lot);
    const { code, product } = splitProduct(cell(row, c.product), cell(row, c.code));
    const id = cell(row, c.id);
    return {
      key: withIds && id ? id : fp([day, ref, code || product, lot, from, to, qty]),
      day, period: day.slice(0, 7), ref, kind: moveKind(from, to, rentals), product, code, lot, from, to, qty,
      uom: cell(row, c.uom), partner: cell(row, c.partner), src: { sheet: g.name, row: i },
    };
  });
  return moves.length ? { moves, withIds } : null;
}

/** Headings of Odoo's product list that give what is on hand in the warehouses (product.product: "Quantity On Hand"). */
const ON_HAND_HEADING = arRx(/^(quantity on hand|qty_available|on hand quantity|الكمية في اليد|الكمية المتاحة)$/i);

export function readStockOnHand(g: Grid, asOf: string): OnHand[] | null {
  const h = header(g);
  if (!h) return null;
  const c = h.col;
  if (c.product === undefined || c.qty === undefined || c.date !== undefined) return null;
  // Without a location column, only Odoo's product list counts: its "Quantity On Hand" is the total in the warehouses
  // (location "" = all of them), and its "Total Value" what that stock is worth.
  if (c.location === undefined && !(g.rows[h.r] ?? []).some((v) => ON_HAND_HEADING.test(normAr(str(v))))) return null;
  const out: OnHand[] = [];
  for (const { row } of dataRows(g, h)) {
    if (!cell(row, c.product)) continue;
    const { code, product } = splitProduct(cell(row, c.product), cell(row, c.code));
    out.push({ asOf, product, code, location: cell(row, c.location), lot: cell(row, c.lot), qty: num(row[c.qty]), value: c.value === undefined ? null : cleanNum(row[c.value] ?? null) });
  }
  return out.length ? out : null;
}

/** Headings of a document list (invoices, bills, orders, journal items), never of a products list. */
const DOCUMENT_HEADING = /(date|تاريخ|number|^ref(erence)?$|رقم|vendor|customer|partner|supplier|مورد|عميل|شريك|account|حساب|total|amount|untaxed|balance|debit|credit|الإجمالي|المبلغ|مدين|دائن)/i;

export function readProducts(g: Grid): ProductRow[] | null {
  const h = header(g);
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

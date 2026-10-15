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
  ["product", arRx(/^(product|product_id|المنتج|الصنف)$/i)],
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

/** A location of the company's own (a warehouse, shelf or the rental pool), not a partner or virtual one: stock held there is the company's. */
export const isInternalLocation = (loc: string) => {
  const l = normAr(loc);
  return !!l && !VENDOR.test(l) && !CUSTOMER.test(l) && !ADJUST.test(l) && !SCRAP.test(l) && !PRODUCTION.test(l) && !/^(virtual|partner)/i.test(l);
};

const isRental = (loc: string, rental?: string | null) => (rental ? normAr(loc).toLowerCase() === normAr(rental).toLowerCase() : RENTAL.test(normAr(loc)));

/** What a move did, from its source and destination locations (Odoo's partner and virtual locations). */
export function moveKind(from: string, to: string, rentalLocation?: string | null): MoveKind {
  const f = normAr(from), t = normAr(to);
  if (VENDOR.test(f)) return "receipt";
  if (VENDOR.test(t)) return "supplier_return";
  if (CUSTOMER.test(t)) return "delivery";
  if (CUSTOMER.test(f)) return "customer_return";
  if (ADJUST.test(f) || ADJUST.test(t)) return "adjustment";
  if (SCRAP.test(f) || SCRAP.test(t)) return "scrap";
  if (PRODUCTION.test(f) || PRODUCTION.test(t)) return "manufacturing";
  const rf = isRental(from, rentalLocation), rt = isRental(to, rentalLocation);
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
  if (ADJ_DESC.test(normAr(description))) return "adjustment";
  return "other";
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

export function readStockValuation(g: Grid): { layers: StockLayer[]; withIds: boolean } | null {
  const h = header(g);
  if (!h) return null;
  const c = h.col;
  if (c.product === undefined || c.qty === undefined || c.value === undefined || (c.ref === undefined && c.desc === undefined)) return null;
  if (c.from !== undefined || c.to !== undefined || c.location !== undefined) return null;
  const withIds = c.id !== undefined;
  const layers: StockLayer[] = [];
  for (const { i, row, day } of dataRows(g, h)) {
    if (!day || !cell(row, c.product)) continue;
    const ref = cell(row, c.ref), desc = cell(row, c.desc), qty = num(row[c.qty]), value = num(row[c.value]);
    const { code, product } = splitProduct(cell(row, c.product), cell(row, c.code));
    const lot = cell(row, c.lot);
    const kind = layerKind(ref, desc + " " + cell(row, c.landed), qty);
    const landedRef = kind === "landed_cost" ? (cell(row, c.landed) || (ref.match(/LC\/[^\s]+/i)?.[0] ?? desc.match(/LC\/[^\s]+/i)?.[0] ?? ref)) : "";
    const id = cell(row, c.id);
    layers.push({
      key: withIds && id ? id : fingerprint([day, ref, code || product, lot, qty, value]),
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
  const moves: StockMove[] = [];
  for (const { i, row, day } of dataRows(g, h)) {
    if (!day || !cell(row, c.product)) continue;
    if (c.status !== undefined && !DONE.test(normAr(cell(row, c.status)))) continue;
    const ref = cell(row, c.ref), from = cell(row, c.from), to = cell(row, c.to), qty = num(row[c.qty]), lot = cell(row, c.lot);
    const { code, product } = splitProduct(cell(row, c.product), cell(row, c.code));
    const id = cell(row, c.id);
    moves.push({
      key: withIds && id ? id : fingerprint([day, ref, code || product, lot, from, to, qty]),
      day, period: day.slice(0, 7), ref, kind: moveKind(from, to, rentalLocation), product, code, lot, from, to, qty,
      uom: cell(row, c.uom), partner: cell(row, c.partner), src: { sheet: g.name, row: i },
    });
  }
  return moves.length ? { moves, withIds } : null;
}

export function readStockOnHand(g: Grid, asOf: string): OnHand[] | null {
  const h = header(g);
  if (!h) return null;
  const c = h.col;
  if (c.location === undefined || c.product === undefined || c.qty === undefined || c.date !== undefined) return null;
  const out: OnHand[] = [];
  for (const { row } of dataRows(g, h)) {
    if (!cell(row, c.product)) continue;
    const { code, product } = splitProduct(cell(row, c.product), cell(row, c.code));
    out.push({ asOf, product, code, location: cell(row, c.location), lot: cell(row, c.lot), qty: num(row[c.qty]), value: c.value === undefined ? null : cleanNum(row[c.value] ?? null) });
  }
  return out.length ? out : null;
}

export function readProducts(g: Grid): ProductRow[] | null {
  const h = header(g);
  if (!h) return null;
  const c = h.col;
  const nameCol = c.name ?? c.product;
  if (nameCol === undefined || c.category === undefined || c.qty !== undefined || c.date !== undefined) return null;
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

/** Every entry on the accounts mapped to Inventory, from a General Ledger upload or the Odoo connection. */
export function stockFromLedger(lines: { code: string; name: string; cls: string | null; excluded: boolean; system?: boolean; entries?: LedgerEntry[] }[]): StockLedgerLine[] {
  const out: StockLedgerLine[] = [];
  for (const l of lines) {
    if (l.excluded || l.system || l.cls !== "inventory" || !l.entries) continue;
    const account = [l.code, l.name].filter(Boolean).join(" ");
    for (const e of l.entries) if (e.amount) out.push({ day: e.day, period: e.period, ref: e.ref, account, amount: Math.round(e.amount * 100) / 100 });
  }
  return out;
}

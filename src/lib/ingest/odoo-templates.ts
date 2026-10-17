import { arRx, normAr, type Cell } from "./parse";
import { str, type Grid } from "./extract";

/**
 * One template per Odoo export: which Odoo column (field label, technical name, English or Arabic) fills which iReport
 * field, and which fields an export must have. A company can point a field at another heading (its own export layout);
 * that choice is kept per export and used before the built-in headings.
 */
export type Field = "id" | "updated" | "date" | "ref" | "product" | "code" | "name" | "category" | "lot" | "qty" | "unitValue" | "value" | "desc" | "landed" | "from" | "to" | "location" | "status" | "partner" | "uom" | "cost" | "type";

/** The headings Odoo 18 uses for each field (list-view labels, technical names of an import-compatible export, Arabic). */
export const HEADINGS: [Field, RegExp][] = [
  ["id", arRx(/^(id|external id|المعرف|المعرّف|المعرف الخارجي|معرف خارجي)$/i)],
  ["updated", arRx(/^(last updated on|last modified on|updated on|write_date|آخر تحديث في|آخر تحديث|تاريخ آخر تحديث)$/i)],
  ["date", arRx(/^(date|date done|create date|create_date|created on|date_done|accounting date|التاريخ|تاريخ|تاريخ الإنشاء)$/i)],
  ["ref", arRx(/^(reference|ref|stock move|stock_move_id|move|picking_id|transfer|المرجع|مرجع|حركة المخزون|التحويل)$/i)],
  ["product", arRx(/^(product|product_id|display name|display_name|المنتج|الصنف|اسم العرض)$/i)],
  ["code", arRx(/^(internal reference|default_code|product\/internal reference|المرجع الداخلي|كود الصنف)$/i)],
  ["name", arRx(/^(name|product name|الاسم|اسم المنتج|اسم الصنف)$/i)],
  ["category", arRx(/^(product category|category|categ_id|فئة المنتج|الفئة)$/i)],
  ["lot", arRx(/^(lot\/serial number|lot\/serial numbers|lot|lot_id|lot_ids|serial number|رقم الدفعة\/الرقم التسلسلي|رقم التشغيلة|الرقم التسلسلي|الدفعة)$/i)],
  ["qty", arRx(/^(quantity|qty|quantity done|qty_done|product_qty|on hand quantity|quantity on hand|qty_available|inventory_quantity|الكمية|الكمية المنتهية|الكمية في اليد|الكمية الفعلية|الكمية المتاحة)$/i)],
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
  ["cost", arRx(/^(cost|standard price|standard_price|average cost|avg_cost|التكلفة|متوسط التكلفة)$/i)],
  ["type", arRx(/^(product type|type|detailed_type|نوع المنتج)$/i)],
];

/** A heading as compared: Arabic letters unified, Odoo's required-field star and extra spaces removed. */
export const cleanHeading = (h: string) => normAr(h.replace(/\s*\*\s*$/, "").replace(/\s+/g, " ").trim());
export const fieldOf = (h: string): Field | null => {
  const t = cleanHeading(h);
  return HEADINGS.find(([, rx]) => rx.test(t))?.[0] ?? null;
};

export type ExportKey = "stock.valuation.layer" | "stock.move.line" | "product.product" | "product.template";
export type ExportKind = "valuation" | "moves" | "onhand" | "products";
export interface TemplateField { field: Field; label: string; required?: boolean; hint?: string }
export interface OdooTemplate { key: ExportKey; kind: ExportKind; title: string; where: string; fields: TemplateField[] }

const ID: TemplateField = { field: "id", label: "Odoo ID", hint: "Ticked “I want to update data (import-compatible export)”: each record keeps Odoo’s own ID." };
const UPDATED: TemplateField = { field: "updated", label: "Last updated on", hint: "Lets “Add new and changed records” replace only what changed in Odoo." };

export const ODOO_TEMPLATES: Record<ExportKey, OdooTemplate> = {
  "stock.valuation.layer": {
    key: "stock.valuation.layer", kind: "valuation", title: "Stock valuation", where: "Inventory → Reporting → Valuation",
    fields: [ID, UPDATED, { field: "date", label: "Date", required: true }, { field: "product", label: "Product", required: true },
      { field: "qty", label: "Quantity", required: true }, { field: "value", label: "Total value", required: true },
      { field: "ref", label: "Reference", required: true, hint: "Or Description." }, { field: "unitValue", label: "Unit value" },
      { field: "desc", label: "Description" }, { field: "lot", label: "Lot/serial number" }, { field: "category", label: "Product category" }],
  },
  "stock.move.line": {
    key: "stock.move.line", kind: "moves", title: "Moves history", where: "Inventory → Reporting → Moves History",
    fields: [ID, UPDATED, { field: "date", label: "Date", required: true }, { field: "product", label: "Product", required: true },
      { field: "from", label: "From", required: true }, { field: "to", label: "To", required: true }, { field: "qty", label: "Quantity", required: true },
      { field: "ref", label: "Reference" }, { field: "status", label: "Status", hint: "Only done moves are saved." }, { field: "lot", label: "Lot/serial number" },
      { field: "uom", label: "Unit of measure" }, { field: "partner", label: "Partner" }],
  },
  "product.product": {
    key: "product.product", kind: "onhand", title: "Stock on hand (product variants)", where: "Inventory → Products → Product Variants",
    fields: [{ field: "product", label: "Product", required: true, hint: "Or Name, with Internal Reference beside it." }, { field: "qty", label: "Quantity on hand", required: true },
      { field: "value", label: "Total value" }, { field: "location", label: "Location" }, { field: "lot", label: "Lot/serial number" }],
  },
  "product.template": {
    key: "product.template", kind: "products", title: "Products", where: "Inventory → Products → Products",
    fields: [{ field: "name", label: "Name", required: true }, { field: "category", label: "Product category", required: true },
      { field: "code", label: "Internal reference" }, { field: "cost", label: "Cost" }, { field: "type", label: "Product type" }],
  },
};
export const KIND_EXPORT: Record<ExportKind, ExportKey> = { valuation: "stock.valuation.layer", moves: "stock.move.line", onhand: "product.product", products: "product.template" };

export type ColumnMap = Partial<Record<Field, number>>;
/** A company's own choices: field → the heading it uses (a heading that is not in the file is ignored). */
export type SavedMapping = Partial<Record<Field, string>>;

/** Which column holds each field: the company's own choices first, then Odoo's headings (the first column wins). */
export function mapColumns(head: Cell[], saved?: SavedMapping | null): ColumnMap {
  const col: ColumnMap = {};
  const heads = head.map((v) => cleanHeading(str(v)).toLowerCase());
  const taken = new Set<number>();
  for (const [f, h] of Object.entries(saved ?? {}) as [Field, string][]) {
    if (!h) continue;
    const i = heads.indexOf(cleanHeading(h).toLowerCase());
    if (i >= 0) { col[f] = i; taken.add(i); }
  }
  head.forEach((v, c) => {
    if (taken.has(c)) return;
    const f = fieldOf(str(v));
    if (f && col[f] === undefined) col[f] = c;
  });
  return col;
}

/** The heading row (within the first 15 rows) and its columns. */
export function findHeader(g: Grid, saved?: SavedMapping | null): { r: number; col: ColumnMap } | null {
  for (let r = 0; r < Math.min(g.rows.length, 15); r++) {
    const col = mapColumns(g.rows[r] ?? [], saved);
    if (col.product !== undefined || col.name !== undefined) return { r, col };
  }
  return null;
}

/** For the preview: every heading in the file, which field each template field reads from, and what is missing. */
export function describeColumns(g: Grid, key: ExportKey, saved?: SavedMapping | null) {
  const t = ODOO_TEMPLATES[key];
  const h = findHeader(g, saved);
  const headings = h ? (g.rows[h.r] ?? []).map((v) => str(v)) : [];
  const fields = t.fields.map((f) => {
    const c = h?.col[f.field];
    return { ...f, col: c ?? null, heading: c === undefined ? null : headings[c] };
  });
  // "Reference" is satisfied by a description on a valuation export, "Product" by a name on the product variants.
  const missing = fields.filter((f) => f.required && f.col === null && !(key === "stock.valuation.layer" && f.field === "ref" && h?.col.desc !== undefined)
    && !(key === "product.product" && f.field === "product" && h?.col.name !== undefined));
  return { headerRow: h?.r ?? null, headings, fields, missing: missing.map((f) => f.label) };
}

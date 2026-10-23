// What each import needs from a sheet: the fields it reads, the heading the import recognises for each (used when the
// person maps a column, so the cleaned file reads the same way), and which fields are required. The column matching is
// the readers' own (salesFieldOf, expenseFieldOf, agencyFieldOf, Odoo's export headings), so preflight never disagrees
// with the import about what a column is.
import type { Cell } from "@/lib/ingest/parse";
import { salesFieldOf } from "@/lib/ingest/sales";
import { expenseFieldOf } from "@/lib/ingest/expenses";
import { agencyFieldOf } from "@/lib/ingest/agency-statement";
import { fieldOf as odooFieldOf, ODOO_TEMPLATES, type ExportKey, type Field as OdooField } from "@/lib/ingest/odoo-templates";

export type FieldType = "date" | "number" | "text";
export interface FieldSpec { key: string; label: string; type: FieldType; heading: string }
export interface ListRules {
  name: string;
  fields: FieldSpec[];
  /** Each group needs one of its fields (e.g. a date or a month). */
  required: string[][];
  /** The field each heading holds, by the readers' own matching. */
  fieldOf: (heading: Cell) => string | null;
  /** A layout with months across the columns: read by the import (info only), or not (blocks). */
  pivotOk: boolean;
  /** The column whose figures a total row adds up. */
  amount: string[];
  /** Rows with this field empty are not lines (an agency statement's collection rows): skipped by the import, never "missing". */
  lineIf?: string;
  /** More labels that mark a closing total row (the statement's "End"). */
  totalRx?: RegExp;
}

const str = (c: Cell) => (c === null || c === undefined ? "" : c instanceof Date ? c.toISOString().slice(0, 10) : String(c).replace(/\s+/g, " ").trim());

export const SALES_RULES: ListRules = {
  name: "Sales",
  fields: [
    { key: "date", label: "Date", type: "date", heading: "Date" }, { key: "period", label: "Month", type: "text", heading: "Month" },
    { key: "doc", label: "Invoice number", type: "text", heading: "Number" }, { key: "customer", label: "Customer", type: "text", heading: "Customer" },
    { key: "product", label: "Product", type: "text", heading: "Product" }, { key: "category", label: "Product category", type: "text", heading: "Product Category" },
    { key: "salesperson", label: "Salesperson", type: "text", heading: "Salesperson" }, { key: "qty", label: "Quantity", type: "number", heading: "Quantity" },
    { key: "untaxed", label: "Untaxed amount", type: "number", heading: "Untaxed Amount" }, { key: "total", label: "Total", type: "number", heading: "Total" },
    { key: "cost", label: "Cost", type: "number", heading: "Cost" }, { key: "margin", label: "Margin", type: "number", heading: "Margin" },
  ],
  required: [["date", "period"], ["untaxed", "total"]],
  fieldOf: (h) => salesFieldOf(str(h)),
  pivotOk: true,
  amount: ["untaxed", "total"],
};

export const EXPENSE_RULES: ListRules = {
  name: "Expenses",
  fields: [
    { key: "date", label: "Date", type: "date", heading: "Date" }, { key: "period", label: "Month", type: "text", heading: "Month" },
    { key: "doc", label: "Bill number", type: "text", heading: "Number" }, { key: "supplier", label: "Vendor", type: "text", heading: "Vendor" },
    { key: "account", label: "Account", type: "text", heading: "Account" }, { key: "category", label: "Category", type: "text", heading: "Category" },
    { key: "label", label: "Description", type: "text", heading: "Label" },
    { key: "untaxed", label: "Untaxed amount", type: "number", heading: "Untaxed Amount" }, { key: "total", label: "Total", type: "number", heading: "Total" },
  ],
  required: [["date", "period"], ["untaxed", "total"]],
  fieldOf: (h) => expenseFieldOf(str(h)),
  pivotOk: false,
  amount: ["untaxed", "total"],
};

/** Simple mode (a Sales and an Expenses sheet, no ERP): the readers' Simple matching, with channel, paid, payment date
 * and fixed or variable as fields of their own, so a "Payment date" is never mistaken for a second Date. */
const SIMPLE_FIELDS: FieldSpec[] = [
  { key: "channel", label: "Channel", type: "text", heading: "Channel" }, { key: "paid", label: "Paid", type: "text", heading: "Paid" },
  { key: "paidOn", label: "Payment date", type: "date", heading: "Payment date" },
];
export const SIMPLE_SALES_RULES: ListRules = { ...SALES_RULES, fields: [...SALES_RULES.fields, ...SIMPLE_FIELDS], fieldOf: (h) => salesFieldOf(str(h), true) };
export const SIMPLE_EXPENSE_RULES: ListRules = {
  ...EXPENSE_RULES,
  fields: [...EXPENSE_RULES.fields, ...SIMPLE_FIELDS.filter((f) => f.key !== "channel"), { key: "fixedVar", label: "Fixed or variable", type: "text", heading: "Fixed or variable" }],
  fieldOf: (h) => expenseFieldOf(str(h), true),
};

export const AGENCY_RULES: ListRules = {
  name: "Agency statement",
  fields: [
    { key: "date", label: "Date", type: "date", heading: "Date" }, { key: "dn", label: "Delivery note", type: "text", heading: "DN #" },
    { key: "ref", label: "Invoice number", type: "text", heading: "Inv #" }, { key: "hospital", label: "Hospital", type: "text", heading: "Name" },
    { key: "funding", label: "Funding type", type: "text", heading: "Type" }, { key: "region", label: "Region", type: "text", heading: "Area" },
    { key: "value", label: "Value", type: "number", heading: "Value" }, { key: "vat", label: "VAT", type: "number", heading: "VAT" },
    { key: "description", label: "Description", type: "text", heading: "Description" },
  ],
  required: [["date"], ["hospital"], ["value"]],
  fieldOf: (h) => agencyFieldOf(h),
  pivotOk: false,
  amount: ["value"],
  lineIf: "value",
  totalRx: /^end$/i,
};

const ODOO_TYPE: Partial<Record<OdooField, FieldType>> = { date: "date", updated: "date", qty: "number", value: "number", unitValue: "number", cost: "number" };
/** Required fields an Odoo stock export can satisfy another way (a description for the reference, a name for the product). */
const ALTERNATE: Partial<Record<ExportKey, Partial<Record<OdooField, OdooField>>>> = { "stock.valuation.layer": { ref: "desc" }, "product.product": { product: "name" } };

/** One Odoo stock export's rules, from its template (the same one the stock import uses). */
export function stockRules(key: ExportKey): ListRules {
  const t = ODOO_TEMPLATES[key];
  const alt = ALTERNATE[key] ?? {};
  const fields: FieldSpec[] = t.fields.map((f) => ({ key: f.field, label: f.label, type: ODOO_TYPE[f.field] ?? "text", heading: f.label }));
  for (const a of Object.values(alt)) if (a && !fields.some((f) => f.key === a)) fields.push({ key: a, label: a === "desc" ? "Description" : "Name", type: "text", heading: a === "desc" ? "Description" : "Name" });
  return {
    name: t.title,
    fields,
    required: t.fields.filter((f) => f.required).map((f) => (alt[f.field] ? [f.field, alt[f.field]!] : [f.field])),
    fieldOf: (h) => odooFieldOf(str(h)),
    pivotOk: false,
    amount: ["value", "qty"],
  };
}
export const STOCK_KEYS = Object.keys(ODOO_TEMPLATES) as ExportKey[];

export const groupLabel = (rules: ListRules, group: string[]) => group.map((k) => rules.fields.find((f) => f.key === k)?.label ?? k).join(" or ");

// A module, described once. The intake reads any table against these definitions: which columns a module needs, how it
// recognises a table of its kind, what it must tie to, and where its rows are kept. Adding a module (one more Odoo app,
// another ERP's list) is one definition file plus its demo rows and tests: the wizard, the checks and the templates follow
// from it. Money follows one rule everywhere: the General Ledger is master; a module adds detail and must agree with it.
import type { ClassKey } from "@/lib/engine";

export interface Bi { en: string; ar: string }
export type FieldType = "date" | "month" | "money" | "qty" | "percent" | "text" | "code";

export interface ModuleField {
  key: string;
  label: Bi;
  type: FieldType;
  /** The column heading iReport's own template uses for this field. */
  heading: string;
  /** Headings (English, Arabic, Odoo labels and technical names) that hold this field. */
  headings: RegExp;
}

/** Where a module's rows are kept: an existing table through its own save, or the store every new module shares. */
export type Storage = "sales_lines" | "expense_lines" | "aged" | "payments" | "generic";

export interface TieDef {
  key: string;
  label: Bi;
  /** P&L or balance-sheet classes the module's total must equal (movement for P&L, balance for the balance sheet). */
  classes: ClassKey[];
  /** "movement": compared month by month; "balance": at the as-of month end. */
  basis: "movement" | "balance";
  /** The module's figure is the opposite sign of the ledger's (revenue is a credit). */
  flip?: boolean;
}

export interface ModuleDef {
  key: string;
  /** "snapshot": a list held at each month end (headcount, assets), never added up across months. Default "flow". */
  nature?: "flow" | "snapshot";
  /** Numeric fields its dashboard totals by month, and text fields it filters and groups by. */
  measures?: string[];
  dimensions?: string[];
  name: Bi;
  /** What the module owns: one owner per record, so nothing is counted twice. */
  owns: Bi;
  /** The navigation sector its pages sit in. */
  sector: string;
  storage: Storage;
  fields: ModuleField[];
  /** Each group needs one of its fields. */
  required: string[][];
  /** The money field whose total is proved from the file to what is saved; then the others, in order, when it is empty. */
  amount: string;
  amountAlt?: string[];
  /** Fields that set the module apart from look-alikes (product and quantity for sales; due date for open items). */
  signature?: string[][];
  /** Headings that argue against the module (a vendor column on a sales list). */
  excludes?: RegExp;
  /** Words in a tab's name that point to the module. */
  sheetWords?: RegExp;
  /** Reads document numbers: a list of mostly vendor bills (BILL/…) is the supplier side. */
  docSide?: "customer" | "supplier";
  /** Field matching shared with an existing reader (so the intake and the reader never disagree); else from `headings`. */
  fieldOf?: (heading: string) => string | null;
  ties?: TieDef[];
  /** A rule a row must pass to be kept (a cancelled payment is not money moved): the reason, or null. */
  rowRule?: (rec: Record<string, string | number | null>) => string | null;
  /** The party and document fields, for the cross-tab checks. */
  party?: string;
  doc?: string;
  date?: string;
}

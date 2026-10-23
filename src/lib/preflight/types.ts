import type { DateOrder } from "@/lib/ingest/parse";

/** The import a file is checked for. The upload wizard's own kinds, plus the stock, payments and agency uploaders. */
export type PreflightModule = "accounts" | "opening" | "sales" | "expenses" | "stock" | "payments" | "agency";

/** Ready: imports as it is. Ready after fixes: safe automatic fixes and/or the person's decisions first. Cannot import yet. */
export type SheetStatus = "ready" | "ready_after_fixes" | "cannot_import";

/** auto: safe, applied for the person and listed. decision: only the person can make it. source: fix it in Odoo or the file. */
export type FixKind = "auto" | "decision" | "source";

export type IssueCode =
  | "empty" | "irrelevant" | "hidden_sheet" | "duplicate_sheet" | "no_header" | "header_below" | "repeated_headings"
  | "missing_column" | "ambiguous_column" | "unused_columns" | "merged_cells" | "blank_rows" | "total_rows" | "total_mismatch"
  | "pivot" | "duplicates" | "missing_values" | "date_formats" | "date_order" | "invalid_dates" | "currencies" | "text_numbers"
  | "invalid_numbers" | "formulas" | "error_cells" | "cut_cells";

export interface PreflightIssue {
  code: IssueCode;
  /** info: nothing to do (said so the person knows); fix: resolved by an automatic fix or a decision; block: cannot import until resolved. */
  level: "info" | "fix" | "block";
  fix: FixKind;
  sheet: string;
  /** Spreadsheet row numbers (as Excel shows them), at most 200. */
  rows?: number[];
  /** Spreadsheet column letters. */
  cols?: string[];
  /** What was found. */
  message: string;
  /** What the module needs, when the issue is about that. */
  needs?: string;
  /** What to change, and why. */
  action: string;
}

export interface PreflightColumn {
  index: number;
  letter: string;
  heading: string;
  /** The field the import reads from this column (null: not used). */
  field: string | null;
  /** How the field was matched: the heading itself, or the person's choice. */
  by: "heading" | "person" | null;
  kind: "number" | "date" | "text" | "empty" | "mixed";
}

export interface SheetReport {
  sheet: string;
  status: SheetStatus;
  /** Whether the sheet goes to the import (the person can change it for hidden, copied and other left-out sheets). */
  include: boolean;
  role: string;
  roleLabel: string;
  hidden: boolean;
  empty: boolean;
  copyOf: string | null;
  /** The heading row's index in the sheet's rows (-1: none), and its spreadsheet row number. */
  headerRow: number;
  headerRowNo: number;
  columns: PreflightColumn[];
  /** Data rows (between the heading and the end, not blank and not totals). */
  dataRows: number;
  dateOrder: DateOrder | null;
  issues: PreflightIssue[];
  /** Fields the person can map, for the column picker (list modules only). */
  fields: { key: string; label: string; required: boolean }[];
  /** Numbers on the sheet (a sheet left out with figures on it is always shown to the person). */
  figures: number;
  /** Stock sheets: which Odoo export they were checked as. */
  stockKey?: string;
}

export interface PreflightReport {
  module: PreflightModule;
  sheets: SheetReport[];
  /** At least one sheet goes to the import and every sheet that goes is ready. */
  ready: boolean;
}

/** The person's decisions for one sheet. */
export interface SheetDecision {
  include?: boolean;
  /** Index in the sheet's rows. */
  headerRow?: number;
  /** field → column index (null: the field takes no column). */
  map?: Record<string, number | null>;
  /** Rows to leave out (indexes in the sheet's rows). */
  exclude?: number[];
  duplicates?: "keep_first" | "keep_all";
  /** Leave out the rows that miss a required value (they are listed as rejected). */
  dropMissing?: boolean;
  /** Leave out rows whose dates or numbers cannot be read, and rows with spreadsheet errors (listed as rejected). */
  dropInvalid?: boolean;
  dateOrder?: DateOrder;
  /** Keep only the rows in this currency (the others are listed as rejected). */
  currency?: string;
  /** Totals that do not equal the rows above: leave them out (true) or keep them as lines (false). */
  dropOddTotals?: boolean;
}
export type Decisions = Record<string, SheetDecision>;

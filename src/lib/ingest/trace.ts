import type { Cell } from "./parse";

/**
 * Where each row of an uploaded sheet went: read as an account, a dated entry of one, a heading, a total iReport
 * recomputes itself, not used (with why), or an error to fix. Shown in the "Your file" box beside iReport's reading.
 */
export type RowRole = "title" | "header" | "heading" | "account" | "entry" | "opening" | "total" | "unused" | "skipped" | "error";
export interface TraceRow { role: RowRole; /** The line it became (RawLine.key, or a sales line index as "s:N"). */ ref?: string; note?: string }

/** A cell that should hold an amount (or a date) but cannot be read. row/col index the sheet as uploaded (0-based). */
export interface CellError { sheet: string; row: number; col: number; text: string; message: string }

/** Row marks made by a reader, indexed by the row in the grid it read. */
export type Marks = (TraceRow | undefined)[];

export const colLetter = (i: number) => { let s = "", n = i + 1; while (n > 0) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); } return s; };

/** "row 37, column F" in the person's spreadsheet (the sheet's used range may not start at A1). */
export function cellRef(row: number, col?: number, origin?: { r: number; c: number }) {
  const r = row + 1 + (origin?.r ?? 0);
  return col === undefined ? `row ${r}` : `row ${r}, column ${colLetter(col + (origin?.c ?? 0))}`;
}

const blank = (v: Cell) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
/** Text in an amount cell that is neither a number nor a dash/nil (those read as zero). */
export const badAmount = (v: Cell, read: number | null) => read === null && !blank(v) && !(v instanceof Date) && typeof v !== "boolean";
export const shown = (v: Cell) => (v === null || v === undefined ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).trim().slice(0, 60);

/** The person's corrections, keyed by the cell as uploaded: "row:col" → what to read there instead (null: empty). */
export interface Fixes { cells?: Record<string, number | string | null>; skipRows?: number[] }

/** A copy of the rows with the corrections applied (skipped rows emptied). The uploaded grid itself is never changed. */
export function applyFixes(rows: Cell[][], f?: Fixes): Cell[][] {
  if (!f || (!f.skipRows?.length && !Object.keys(f.cells ?? {}).length)) return rows;
  const out = rows.map((r) => (r ? r.slice() : r));
  for (const [k, v] of Object.entries(f.cells ?? {})) {
    const [r, c] = k.split(":").map(Number);
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= out.length) continue;
    out[r] ??= [];
    out[r][c] = v;
  }
  for (const r of f.skipRows ?? []) if (r >= 0 && r < out.length) out[r] = [];
  return out;
}

/** One correction, as stored with the import and listed on Data health. */
export interface FixRecord { sheet: string; row: number; col?: number; action: "set" | "empty" | "skip-row"; value?: number | string; was?: string }

export function fixRecords(sheet: string, rows: Cell[][], f?: Fixes): FixRecord[] {
  if (!f) return [];
  const out: FixRecord[] = [];
  for (const [k, v] of Object.entries(f.cells ?? {})) {
    const [r, c] = k.split(":").map(Number);
    out.push({ sheet, row: r, col: c, action: v === null ? "empty" : "set", ...(v === null ? {} : { value: v }), was: shown(rows[r]?.[c]) });
  }
  for (const r of f.skipRows ?? []) out.push({ sheet, row: r, action: "skip-row", was: (rows[r] ?? []).map(shown).filter(Boolean).join(" | ").slice(0, 80) });
  return out.sort((a, b) => a.row - b.row);
}

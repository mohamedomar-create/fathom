// What AI assist sees and what it may answer. Only a sample leaves the app: the tab's name and title, the rows before the
// data, and up to 20 data rows, each cell cut to 60 characters. The answer is a suggestion: it names a module and a field
// for some columns, and only modules and fields that exist and columns that are in the table survive the check.
import { z } from "zod";
import type { Cell } from "@/lib/ingest/parse";
import { MODULES, moduleByKey } from "@/lib/modules/registry";
import type { Piece } from "./split";

export const SAMPLE_ROWS = 20;
const HEAD_ROWS = 10;
const MAX_COLS = 30;
const MAX_CELL = 60;

export interface Sample { sheet: string; title: string | null; rows: (string | null)[][]; totalRows: number }

const cell = (v: Cell): string | null => {
  if (v === null || v === undefined) return null;
  const t = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).replace(/\s+/g, " ").trim();
  return t ? t.slice(0, MAX_CELL) : null;
};

/** The sample: rows up to the first ten (where headings sit), then data rows, up to 20 after the first row with figures. */
export function sampleOf(p: Piece): Sample {
  const firstData = p.rows.findIndex((r) => (r ?? []).some((v) => typeof v === "number"));
  const head = firstData < 0 ? Math.min(p.rows.length, HEAD_ROWS) : Math.min(firstData, HEAD_ROWS);
  const keep = p.rows.slice(0, head + SAMPLE_ROWS);
  return { sheet: p.sheet.slice(0, 100), title: p.title?.slice(0, 200) ?? null, rows: keep.map((r) => (r ?? []).slice(0, MAX_COLS).map(cell)), totalRows: p.rows.filter((r) => (r ?? []).some((v) => v !== null && v !== undefined && String(v).trim())).length };
}

/** The answer the model must give. */
export const SuggestionSchema = z.object({
  module: z.string().max(40),
  headerRow: z.number().int().min(0).max(200),
  columns: z.array(z.object({ column: z.number().int().min(0).max(200), field: z.string().max(40).nullable(), confidence: z.number().min(0).max(1) })).max(60),
  reason: z.string().max(500),
});
export type Suggestion = z.infer<typeof SuggestionSchema>;
export interface CheckedSuggestion { module: string; headerRow: number; override: Record<number, string>; confidence: Record<number, number>; reason: string }

/** The suggestion as the wizard may use it, or null when it names no module, a module that doesn't exist, or a row outside the table. */
export function checkSuggestion(s: Suggestion, p: Piece): CheckedSuggestion | null {
  const m = moduleByKey(s.module);
  if (!m || s.headerRow >= p.rows.length) return null;
  const width = (p.rows[s.headerRow] ?? []).length;
  const fields = new Set(m.fields.map((f) => f.key));
  const override: Record<number, string> = {}, confidence: Record<number, number> = {};
  const used = new Set<string>();
  for (const c of s.columns) {
    if (!c.field || !fields.has(c.field) || c.column >= width || used.has(c.field) || c.column in override) continue;
    override[c.column] = c.field; confidence[c.column] = c.confidence; used.add(c.field);
  }
  return { module: m.key, headerRow: s.headerRow, override, confidence, reason: s.reason.slice(0, 500) };
}

/** The modules described to the model: keys, names and fields (no company data). */
export const moduleCatalogue = () => MODULES.map((m) => ({ key: m.key, name: m.name.en, fields: m.fields.map((f) => ({ key: f.key, label: f.label.en, type: f.type })), required: m.required }));

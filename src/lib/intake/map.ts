// Which row holds the headings and which column fills which field. Every column is accounted for: mapped to a field, or
// listed as not used (never dropped quietly); every required field the table lacks is named.
import type { Cell } from "@/lib/ingest/parse";
import { normAr } from "@/lib/ingest/parse";
import { fieldOf } from "@/lib/modules/registry";
import type { ModuleDef } from "@/lib/modules/types";
import type { Piece } from "./split";

export interface Mapping {
  module: string;
  /** Index in piece.rows of the headings row. */
  headerRow: number;
  /** Field → column index in the piece. */
  cols: Record<string, number>;
  /** Columns with a heading that no field takes, and columns that repeat a field already taken. */
  unmapped: { col: number; heading: string; why: "unknown" | "repeat" }[];
  /** Required groups the table has no column for, as labels ("Date or Month"). */
  missing: string[];
}

const text = (v: Cell) => (v === null || v === undefined ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).replace(/\s+/g, " ").trim());
/** A heading as remembered: Arabic letters unified, case and spaces ignored. */
export const headingKey = (h: string) => normAr(h.replace(/\s+/g, " ").trim().toLowerCase());

/** The headings row: the row (of the first 30) where most columns are fields of the module. */
function headerRowOf(p: Piece, m: ModuleDef): number {
  let best = -1, bestN = 0;
  for (let r = 0; r < Math.min(p.rows.length, 30); r++) {
    const seen = new Set<string>();
    for (const v of p.rows[r] ?? []) { const k = typeof v === "string" ? fieldOf(m, v) : null; if (k) seen.add(k); }
    if (seen.size > bestN) { best = r; bestN = seen.size; }
  }
  if (best >= 0) return best;
  return Math.max(0, p.rows.findIndex((r) => (r ?? []).some((v) => text(v))));
}

export const groupLabel = (m: ModuleDef, group: string[]) => group.map((k) => m.fields.find((f) => f.key === k)?.label.en ?? k).join(" or ");

/**
 * The mapping. `saved`: a remembered choice for this layout (heading → field, "" for a column the person left out),
 * used before the module's own headings; `override` (column → field or null) is the person's choice on this upload.
 */
export function mapPiece(p: Piece, m: ModuleDef, opts: { headerRow?: number; saved?: Record<string, string>; override?: Record<number, string | null> } = {}): Mapping {
  const headerRow = opts.headerRow ?? headerRowOf(p, m);
  const heads = (p.rows[headerRow] ?? []).map(text);
  const cols: Record<string, number> = {};
  const unmapped: Mapping["unmapped"] = [];
  const known = new Set(m.fields.map((f) => f.key));
  heads.forEach((h, c) => {
    if (!h) return;
    let k: string | null;
    if (opts.override && c in opts.override) k = opts.override[c];
    else if (opts.saved && headingKey(h) in opts.saved) k = opts.saved[headingKey(h)] || null;
    else k = fieldOf(m, h);
    if (!k || !known.has(k)) { unmapped.push({ col: c, heading: h, why: "unknown" }); return; }
    if (k in cols) { unmapped.push({ col: c, heading: h, why: "repeat" }); return; }
    cols[k] = c;
  });
  // A column the person points at a field that has no heading (an empty heading cell).
  for (const [c, k] of Object.entries(opts.override ?? {})) if (k && known.has(k) && !(k in cols) && !heads[+c]) cols[k] = +c;
  const missing = m.required.filter((g) => !g.some((k) => k in cols)).map((g) => groupLabel(m, g));
  return { module: m.key, headerRow, cols, unmapped, missing };
}

/** The choice to remember for this layout: each heading and the field it fills ("" when the person left it out). */
export function rememberable(p: Piece, map: Mapping): Record<string, string> {
  const heads = (p.rows[map.headerRow] ?? []).map(text);
  const out: Record<string, string> = {};
  for (const h of heads) if (h) out[headingKey(h)] = "";
  for (const [k, c] of Object.entries(map.cols)) if (heads[c]) out[headingKey(heads[c])] = k;
  return out;
}

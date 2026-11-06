// A tab is not always one table: finance teams put receivables and payables side by side, or stack this month's list
// under last month's with a title between them. Each table becomes a piece with its own headings, its place on the
// sheet (so every row number stays the spreadsheet's own) and the title rows above it.
import type { Cell } from "@/lib/ingest/parse";
import type { Grid } from "@/lib/ingest/extract";

export interface Piece {
  /** "Sales" or, for the second table on a tab, "Sales › table 2". */
  id: string;
  sheet: string;
  title?: string;
  rows: Cell[][];
  /** Where the piece starts in the grid (0-based row and column). */
  origin: { r: number; c: number };
  /** Where the grid starts in the spreadsheet (rows and columns before it were empty). */
  gridOrigin: { r: number; c: number };
  date1904?: boolean;
  hidden?: boolean;
}

const filled = (v: Cell) => v !== null && v !== undefined && !(typeof v === "string" && !v.trim());
const isNum = (v: Cell) => typeof v === "number" || (typeof v === "string" && /^[\s(\-]*[\d.,]+\)?\s*$/.test(v) && /\d/.test(v));
const count = (row: Cell[] | undefined) => (row ?? []).filter(filled).length;
const text = (v: Cell) => (v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim());

/** The whole grid as one piece. */
export function pieceOf(g: Grid): Piece {
  return { id: g.name, sheet: g.name, rows: g.rows, origin: { r: 0, c: 0 }, gridOrigin: g.origin ?? { r: 0, c: 0 }, date1904: g.date1904, hidden: g.hidden };
}

/** A row that reads like column headings: two or more cells, all text. */
const headingLike = (row: Cell[] | undefined) => { const c = (row ?? []).filter(filled); return c.length >= 2 && c.every((v) => !isNum(v)); };
/** A table: a headings row followed by at least one row with a number. */
function isTable(rows: Cell[][]): boolean {
  const h = rows.findIndex(headingLike);
  return h >= 0 && rows.slice(h + 1).some((r) => (r ?? []).some((v) => isNum(v)));
}

/** Column runs separated by columns empty from top to bottom. */
function columnBlocks(rows: Cell[][]): [number, number][] {
  const width = Math.max(0, ...rows.map((r) => r?.length ?? 0));
  const used = Array.from({ length: width }, (_, c) => rows.some((r) => filled(r?.[c])));
  const out: [number, number][] = [];
  for (let c = 0; c < width; c++) {
    if (!used[c]) continue;
    const s = c;
    while (c + 1 < width && used[c + 1]) c++;
    out.push([s, c]);
  }
  return out;
}

/** Row runs separated by empty rows; a run with no table (titles, notes) becomes the title of the next one. */
function rowSegments(rows: Cell[][]): { start: number; rows: Cell[][]; title: string[] }[] {
  const runs: { start: number; rows: Cell[][] }[] = [];
  for (let r = 0; r < rows.length; r++) {
    if (!count(rows[r])) continue;
    const s = r;
    while (r + 1 < rows.length && count(rows[r + 1])) r++;
    runs.push({ start: s, rows: rows.slice(s, r + 1) });
  }
  const out: { start: number; rows: Cell[][]; title: string[] }[] = [];
  let titles: string[] = [];
  for (const run of runs) {
    // Single-cell rows at the top are titles ("Expenses", "As of 31 Oct").
    let k = 0;
    while (k < run.rows.length && count(run.rows[k]) <= 1) { titles.push(text((run.rows[k] ?? []).find(filled))); k++; }
    const body = run.rows.slice(k);
    if (!body.length) continue;
    if (isTable(body) && headingLike(body[0])) { out.push({ start: run.start + k, rows: body, title: titles }); titles = []; }
    // Rows that don't start a new table belong to the table above (a gap inside the list), or are notes before any table.
    else if (out.length) { const last = out[out.length - 1]; const gap = run.start + k - (last.start + last.rows.length); last.rows.push(...Array.from({ length: gap }, () => []), ...body); }
    else { out.push({ start: run.start + k, rows: body, title: titles }); titles = []; }
  }
  return out;
}

/**
 * The tables on a tab. A tab that splits only into pieces without a table of their own stays whole: a split is kept only
 * when every piece is a table (headings and figures).
 */
export function splitGrid(g: Grid): Piece[] {
  const whole = pieceOf(g);
  const blocks = columnBlocks(g.rows);
  const pieces: Piece[] = [];
  for (const [c0, c1] of blocks) {
    const sub = g.rows.map((r) => (r ?? []).slice(c0, c1 + 1));
    for (const seg of rowSegments(sub)) {
      pieces.push({ ...whole, rows: seg.rows, origin: { r: seg.start, c: c0 }, title: seg.title.filter(Boolean).join(" · ") || undefined, id: "" });
    }
  }
  const tables = pieces.filter((p) => isTable(p.rows));
  if (!tables.length) return [whole];
  // Text-only pieces (a note beside the table) become part of its title. A piece with figures but no headings is kept
  // as a piece of its own, so the person sees it: nothing with a number in it is folded away.
  const notes = pieces.filter((p) => !isTable(p.rows) && !p.rows.some((r) => (r ?? []).some(isNum)));
  const keep = pieces.filter((p) => !notes.includes(p));
  const noteText = notes.flatMap((x) => x.rows.map((r) => (r ?? []).filter(filled).map(text).join(" "))).filter(Boolean);
  if (keep.length === 1) return [{ ...keep[0], id: g.name, title: [...noteText, keep[0].title].filter(Boolean).join(" · ") || undefined }];
  return keep.map((p, i) => ({ ...p, id: i ? `${g.name} › table ${i + 1}` : g.name, title: i === 0 && noteText.length ? [...noteText, p.title].filter(Boolean).join(" · ") : p.title }));
}

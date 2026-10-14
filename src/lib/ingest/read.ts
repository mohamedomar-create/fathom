import type { Grid } from "./extract";
import type { Cell } from "./parse";

/** Text of a CSV/TXT export in whatever encoding it was saved: UTF-8, UTF-16 (Excel "Unicode text"), or Windows Arabic (1256). */
export function decodeText(data: ArrayBuffer): string {
  const b = new Uint8Array(data);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b.subarray(2));
  // UTF-16 without a byte-order mark: every other byte is the high byte of Latin (00) or Arabic (06) letters.
  const head = b.subarray(0, Math.min(b.length, 400));
  const high = (odd: number) => head.filter((x, i) => i % 2 === odd && (x === 0 || x === 6)).length;
  if (head.length >= 8) {
    if (high(1) > head.length * 0.4) return new TextDecoder("utf-16le").decode(b);
    if (high(0) > head.length * 0.4) return new TextDecoder("utf-16be").decode(b);
  }
  let text = new TextDecoder("utf-8").decode(b);
  if ((text.match(/�/g) ?? []).length > 3) text = new TextDecoder("windows-1256").decode(b);
  return text.replace(/^﻿/, "");
}

/**
 * CSV cells arrive as text, so dates keep their written order (03/04/2026 is decided by the column, not guessed US-style)
 * and amounts keep their written decimal mark. Plain numbers become numbers, except when the file writes "1.234,50":
 * then "1.234" is a thousand, left as text for the sheet's decimal reading.
 */
export function csvCells(rows: Cell[][]): Cell[][] {
  let eu = 0, us = 0;
  for (const r of rows) for (const v of r) {
    if (typeof v !== "string") continue;
    const t = v.trim();
    if (/^\(?-?\d{1,3}(\.\d{3})+,\d+\)?$/.test(t) || /^\(?-?\d+,\d{1,2}\)?$/.test(t)) eu++;
    else if (/^\(?-?\d{1,3}(,\d{3})+\.\d+\)?$/.test(t)) us++;
  }
  const plain = eu > us ? /^-?\d+$/ : /^-?\d+(\.\d+)?$/;
  return rows.map((r) => r.map((v) => {
    if (typeof v !== "string") return v;
    const t = v.trim();
    if (t === "") return null;
    // Long digit runs (account or reference numbers with leading zeros) stay text.
    return plain.test(t) && !/^-?0\d/.test(t) && t.replace("-", "").replace(".", "").length <= 15 ? Number(t) : t;
  }));
}

type Merge = { s: { r: number; c: number }; e: { r: number; c: number } };

/**
 * Merged cells keep their value in the top-left cell only. Headings merged across Debit/Credit pairs ("Opening balance")
 * or down two heading rows ("Account") are copied into every cell they cover, so each column has its full heading.
 * Rows holding amounts are left alone, so a merged account name is never counted twice.
 */
export function fillMerges(rows: Cell[][], merges: Merge[] = []): Cell[][] {
  const hasNumber = (r: number) => (rows[r] ?? []).some((v) => typeof v === "number");
  for (const m of merges) {
    const v = rows[m.s.r]?.[m.s.c];
    if (typeof v !== "string" || !v.trim()) continue;
    for (let r = m.s.r; r <= m.e.r; r++) {
      if (hasNumber(r)) continue;
      rows[r] ??= [];
      for (let c = m.s.c; c <= m.e.c; c++) if (rows[r][c] === null || rows[r][c] === undefined || rows[r][c] === "") rows[r][c] = v;
    }
  }
  return rows;
}

/** Read an .xlsx / .xls / .csv file into grids (one per sheet). Runs in the browser or Node. */
export async function readWorkbook(data: ArrayBuffer, filename: string): Promise<Grid[]> {
  const XLSX = await import("@e965/xlsx");
  const isCsv = /\.(csv|txt|tsv)$/i.test(filename);
  const wb = isCsv
    ? XLSX.read(decodeText(data), { type: "string", raw: true })
    : XLSX.read(new Uint8Array(data), { type: "array", cellDates: true });
  return wb.SheetNames.map((name): Grid => {
    const ws = wb.Sheets[name];
    if (isCsv) return { name: filename.replace(/\.[^.]+$/, ""), rows: csvCells(XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: null, blankrows: true })) };
    if (!ws["!ref"]) return { name, rows: [] };
    // Rows and columns are counted from the sheet's used range, which need not start at A1.
    const at = XLSX.utils.decode_range(ws["!ref"]).s;
    const cells: { r: number; c: number; cell: SheetCell }[] = [];
    for (const k of Object.keys(ws)) {
      if (k[0] === "!") continue;
      const cell = ws[k] as SheetCell;
      if ((cell.v === undefined || cell.v === null || cell.v === "") && !cell.f) continue;
      const a = XLSX.utils.decode_cell(k);
      cells.push({ r: a.r, c: a.c, cell });
    }
    if (!cells.length) return { name, rows: [] };
    const { end, cut } = extent(cells, at, XLSX.utils.encode_col);
    const rows = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: null, blankrows: true, range: { s: at, e: end } });
    const formulas: Record<string, string> = {};
    let broken = 0;
    for (const { r, c, cell } of cells) {
      if (r > end.r || c > end.c) continue;
      const i = r - at.r, j = c - at.c;
      // An error cell (#REF!, #DIV/0!) would otherwise read as empty: it keeps its text, so whatever needs it says so.
      if (cell.t === "e") { (rows[i] ??= [])[j] = String(cell.w ?? "#ERROR!"); broken++; continue; }
      if (cell.f) formulas[`${i}:${j}`] = String(cell.f);
    }
    const merges = ((ws["!merges"] ?? []) as Merge[]).map((m) => ({ s: { r: m.s.r - at.r, c: m.s.c - at.c }, e: { r: m.e.r - at.r, c: m.e.c - at.c } }));
    return {
      name, rows: fillMerges(rows, merges), origin: at,
      ...(Object.keys(formulas).length ? { formulas } : {}), ...(cut.length ? { cut } : {}), ...(broken ? { broken } : {}),
    };
  });
}

type SheetCell = { t?: string; v?: unknown; w?: string; f?: string };
/** Columns (or rows) this far past the table's last filled one are not part of it: cells pasted across a whole row, stray notes. */
export const FAR_COLS = 15, FAR_ROWS = 200;

/**
 * Where the table ends. A run of FAR_COLS empty columns (or FAR_ROWS empty rows) after it separates the table from cells
 * far away: those are left out, and named, so nothing is dropped silently.
 */
export function extent(cells: { r: number; c: number }[], at: { r: number; c: number }, col: (c: number) => string) {
  const cut: NonNullable<Grid["cut"]> = [];
  const edge = (vals: number[], start: number, gap: number) => {
    const s = [...new Set(vals)].sort((a, b) => a - b);
    let last = Math.max(start, s[0]);
    for (const v of s) { if (v - last > gap) return { end: last, far: v }; last = Math.max(last, v); }
    return { end: last, far: null as number | null };
  };
  const cs = edge(cells.map((x) => x.c), at.c, FAR_COLS);
  // A long scattered tail (a row pasted across the sheet leaves one to three cells every few columns) past the last
  // well-filled column is not part of the table either. A note or two beside the table is kept.
  if (cs.far === null) {
    const per = new Map<number, number>();
    for (const x of cells) per.set(x.c, (per.get(x.c) ?? 0) + 1);
    const full = Math.max(...per.values());
    const dense = [...per].filter(([, n]) => n >= Math.max(4, full * 0.1)).map(([c]) => c);
    if (dense.length) {
      let prev = Math.max(...dense);
      const later = [...per.keys()].filter((c) => c > prev).sort((a, b) => a - b);
      for (const c of later) {
        if (c - prev >= 4) { if (Math.max(...later) - c > 30) { cs.far = c; cs.end = prev; } break; }
        prev = c;
      }
    }
  }
  if (cs.far !== null) {
    const away = cells.filter((x) => x.c > cs.end);
    cut.push({ what: "columns", from: col(cs.far), to: col(Math.max(...away.map((x) => x.c))), cells: away.length, rows: [...new Set(away.map((x) => x.r + 1))].sort((a, b) => a - b).slice(0, 12) });
  }
  const inCols = cells.filter((x) => x.c <= cs.end);
  const rs = edge(inCols.map((x) => x.r), at.r, FAR_ROWS);
  if (rs.far !== null) {
    const away = inCols.filter((x) => x.r > rs.end);
    cut.push({ what: "rows", from: String(rs.far + 1), to: String(Math.max(...away.map((x) => x.r)) + 1), cells: away.length, rows: [...new Set(away.map((x) => x.r + 1))].sort((a, b) => a - b).slice(0, 12) });
  }
  return { end: { r: rs.end, c: cs.end }, cut };
}

/** Several files read as one upload: sheets are named "file › sheet" so each stays identifiable. */
export async function readWorkbooks(files: { name: string; data: ArrayBuffer }[]): Promise<Grid[]> {
  const all = await Promise.all(files.map((f) => readWorkbook(f.data, f.name)));
  if (files.length === 1) return all[0];
  return all.flatMap((grids, i) => grids.map((g) => ({ ...g, name: `${files[i].name.replace(/\.[^.]+$/, "")} › ${g.name}`.slice(0, 120) })));
}

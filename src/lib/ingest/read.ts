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
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });
    if (isCsv) return { name: filename.replace(/\.[^.]+$/, ""), rows: csvCells(rows) };
    // Rows and columns are counted from the sheet's used range, which need not start at A1.
    const at = XLSX.utils.decode_range(ws["!ref"] ?? "A1").s;
    const merges = ((ws["!merges"] ?? []) as Merge[]).map((m) => ({ s: { r: m.s.r - at.r, c: m.s.c - at.c }, e: { r: m.e.r - at.r, c: m.e.c - at.c } }));
    return { name, rows: fillMerges(rows, merges) };
  });
}

/** Several files read as one upload: sheets are named "file › sheet" so each stays identifiable. */
export async function readWorkbooks(files: { name: string; data: ArrayBuffer }[]): Promise<Grid[]> {
  const all = await Promise.all(files.map((f) => readWorkbook(f.data, f.name)));
  if (files.length === 1) return all[0];
  return all.flatMap((grids, i) => grids.map((g) => ({ ...g, name: `${files[i].name.replace(/\.[^.]+$/, "")} › ${g.name}`.slice(0, 120) })));
}

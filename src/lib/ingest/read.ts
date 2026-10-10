import type { Grid } from "./extract";
import type { Cell } from "./parse";

/** Read an .xlsx / .xls / .csv file into grids (one per sheet). Runs in the browser or Node. */
export async function readWorkbook(data: ArrayBuffer, filename: string): Promise<Grid[]> {
  const XLSX = await import("@e965/xlsx");
  const isCsv = /\.(csv|txt|tsv)$/i.test(filename);
  let wb;
  if (isCsv) {
    let text = new TextDecoder("utf-8").decode(data);
    if ((text.match(/�/g) ?? []).length > 3) text = new TextDecoder("windows-1256").decode(data); // Arabic Windows exports
    wb = XLSX.read(text.replace(/^﻿/, ""), { type: "string", cellDates: true, raw: false });
  } else {
    wb = XLSX.read(new Uint8Array(data), { type: "array", cellDates: true });
  }
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });
    return { name: isCsv ? filename.replace(/\.[^.]+$/, "") : name, rows };
  });
}

/** Several files read as one upload: sheets are named "file › sheet" so each stays identifiable. */
export async function readWorkbooks(files: { name: string; data: ArrayBuffer }[]): Promise<Grid[]> {
  const all = await Promise.all(files.map((f) => readWorkbook(f.data, f.name)));
  if (files.length === 1) return all[0];
  return all.flatMap((grids, i) => grids.map((g) => ({ ...g, name: `${files[i].name.replace(/\.[^.]+$/, "")} › ${g.name}`.slice(0, 120) })));
}

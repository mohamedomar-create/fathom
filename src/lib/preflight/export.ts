import type { Grid } from "@/lib/ingest/extract";
import type { Cell } from "@/lib/ingest/parse";
import { isoDay } from "./inspect";

/** Spreadsheet files preflight can read (PDFs and images go to the page reader instead). */
export const supportedFile = (name: string) => /\.(xlsx|xlsm|xls|csv|txt|tsv)$/i.test(name);

const cellText = (v: Cell) => (v === null || v === undefined ? "" : v instanceof Date ? isoDay(v) : String(v));

/** One sheet as CSV (UTF-8, comma-separated, quoted where needed). */
export function toCsv(g: Grid): string {
  return g.rows.map((r) => (r ?? []).map((v) => {
    const t = cellText(v);
    return /[",\n\r]/.test(t) || t !== t.trim() ? `"${t.replace(/"/g, '""')}"` : t;
  }).join(",")).join("\n");
}

/** The cleaned sheets as one .xlsx workbook. */
export async function toXlsx(grids: Grid[]): Promise<Uint8Array> {
  const XLSX = await import("@e965/xlsx");
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const g of grids) {
    let name = g.name.replace(/[\\/?*[\]:]/g, " ").replace(/›/g, "-").trim().slice(0, 31) || "Sheet";
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${name.slice(0, 27)} (${n})`;
    used.add(name.toLowerCase());
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(g.rows.map((r) => (r ?? []).map((v) => (v instanceof Date ? isoDay(v) : v ?? null)))), name);
  }
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

// Reading a mapped table row by row. Every row with something in it ends in one of three lists: kept (a record), rejected
// (with the reason, e.g. a date that can't be read), or skipped on purpose (a total row, a section title). Then the
// proof: the money read from the file equals the money kept plus the money rejected, and the file's own total agrees.
import { cleanNum, detectDateOrder, normAr, parseDay, parsePeriod, TOTAL_LABEL, type Cell, type DateOrder } from "@/lib/ingest/parse";
import type { ModuleDef } from "@/lib/modules/types";
import { groupLabel, type Mapping } from "./map";
import type { Piece } from "./split";

export type Value = string | number | null;
export type Rec = Record<string, Value> & { __row: number; __period: string | null };
export interface RowIssue { row: number; reason: string; amount: number | null; cells: string[] }
export interface Proof {
  /** Money in the amount column of every row read (kept, rejected): what the file holds. */
  amountIn: number;
  amountOut: number;
  amountRejected: number;
  /** The file's own total row, when it has one, against the rows above it. */
  fileTotal: { stated: number; read: number; ok: boolean } | null;
  ok: boolean;
}
export interface ReadOut { records: Rec[]; rejected: RowIssue[]; skipped: RowIssue[]; proof: Proof; rowsRead: number }

const r2 = (n: number) => Math.round(n * 100) / 100 || 0;
const filled = (v: Cell) => v !== null && v !== undefined && !(typeof v === "string" && !v.trim());
const text = (v: Cell) => (v === null || v === undefined ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).replace(/\s+/g, " ").trim());
const pad = (n: number) => String(n).padStart(2, "0");
/** A total label with nothing after it but a word or two ("Total", "Grand total", "Total for October"). */
const TOTAL_ONLY = /^\S+(\s+\S+){0,3}$/;

/** An Excel date serial (days from 1899-12-30, or from 1904 in old Mac workbooks). */
function serialDay(n: number, date1904?: boolean): string | null {
  if (!Number.isFinite(n) || n < 1 || n > 2958465) return null;
  const d = new Date(Math.round((n + (date1904 ? 1462 : 0) - 25569) * 86_400_000));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function dayOf(v: Cell, order: DateOrder, date1904?: boolean): string | null {
  if (typeof v === "number") return v > 20000 ? serialDay(v, date1904) : null;
  return parseDay(v, order);
}

/** The value a cell gives a field, or an error when it holds something that can't be read as that field. */
function parse(v: Cell, type: string, order: DateOrder, date1904?: boolean): { value: Value; bad: boolean } {
  if (!filled(v)) return { value: null, bad: false };
  switch (type) {
    case "date": { const d = dayOf(v, order, date1904); return { value: d, bad: d === null }; }
    // A small number in a Month column is a month number (10), not a date serial: it says nothing the Date doesn't.
    case "month": { if (typeof v === "number") { const p = v > 20000 ? serialDay(v, date1904)?.slice(0, 7) ?? null : null; return { value: p, bad: v > 20000 && p === null }; } const p = parsePeriod(v, order); return { value: p, bad: p === null }; }
    case "money": case "qty": case "percent": { const n = cleanNum(v); return { value: n === null ? null : r2(n), bad: n === null }; }
    default: return { value: text(v), bad: false };
  }
}

export function readRecords(p: Piece, m: ModuleDef, map: Mapping): ReadOut {
  const base = p.gridOrigin.r + p.origin.r + 1;
  const body = p.rows.slice(map.headerRow + 1);
  const orders: Record<string, DateOrder> = {};
  for (const f of m.fields) {
    const c = map.cols[f.key];
    if (c === undefined || (f.type !== "date" && f.type !== "month")) continue;
    orders[f.key] = detectDateOrder(body.map((r) => r?.[c])).order ?? "dmy";
  }
  const money = [m.amount, ...(m.amountAlt ?? [])].filter((k) => k in map.cols);
  const amountOf = (row: Cell[]): number | null => {
    for (const k of money) { const n = cleanNum(row[map.cols[k]]); if (n !== null && filled(row[map.cols[k]])) return r2(n); }
    return null;
  };
  const records: Rec[] = [], rejected: RowIssue[] = [], skipped: RowIssue[] = [];
  const totals: number[] = [];
  let amountIn = 0, rowsRead = 0;
  body.forEach((raw, i) => {
    const row = raw ?? [];
    const cells = row.filter(filled);
    if (!cells.length) return;
    rowsRead++;
    const spreadsheetRow = base + map.headerRow + 1 + i;
    const shown = row.map(text);
    const amount = amountOf(row);
    // A total row: the label is the row's first filled cell and its only text ("Total", "الإجمالي"). A customer called
    // "Total Egypt" or a product "Total Care Kit" is a row, not a total.
    const texts = row.filter((v) => typeof v === "string" && v.trim() && cleanNum(v) === null);
    const firstText = typeof cells[0] === "string" ? normAr(text(cells[0])) : "";
    if (texts.length === 1 && firstText && TOTAL_LABEL.test(firstText) && TOTAL_ONLY.test(firstText)) {
      skipped.push({ row: spreadsheetRow, reason: "total row", amount, cells: shown });
      if (amount !== null) totals.push(amount);
      return;
    }
    if (cells.length === 1 && typeof cells[0] === "string" && amount === null) { skipped.push({ row: spreadsheetRow, reason: "section title", amount: null, cells: shown }); return; }
    if (amount !== null) amountIn = r2(amountIn + amount);
    const rec: Record<string, Value> = {};
    const bad: string[] = [];
    for (const f of m.fields) {
      const c = map.cols[f.key];
      if (c === undefined) continue;
      const { value, bad: isBad } = parse(row[c], f.type, orders[f.key] ?? "dmy", p.date1904);
      if (isBad) bad.push(`${f.label.en} can't be read: "${text(row[c]).slice(0, 40)}"`);
      if (value !== null) rec[f.key] = value;
    }
    for (const g of m.required) if (!g.some((k) => rec[k] !== null && rec[k] !== undefined && rec[k] !== "")) bad.push(`${groupLabel(m, g)} is empty`);
    const rule = m.rowRule?.(rec);
    if (rule) bad.push(rule);
    if (bad.length) { rejected.push({ row: spreadsheetRow, reason: bad.join("; "), amount, cells: shown }); return; }
    const day = (m.date && typeof rec[m.date] === "string" ? (rec[m.date] as string) : null) ?? (Object.entries(rec).find(([k, v]) => m.fields.find((f) => f.key === k)?.type === "date" && typeof v === "string")?.[1] as string | undefined) ?? null;
    // The day's month when there is a day (a Month column can only agree with it); else the Month column.
    const period = day ? day.slice(0, 7) : typeof rec.period === "string" ? rec.period : null;
    records.push({ ...rec, __row: spreadsheetRow, __period: period });
  });
  const sum = (xs: (number | null)[]) => r2(xs.reduce<number>((s, x) => s + (x ?? 0), 0));
  const amountOut = sum(records.map((r) => money.map((k) => r[k]).find((v): v is number => typeof v === "number") ?? null));
  const amountRejected = sum(rejected.map((r) => r.amount));
  let fileTotal: Proof["fileTotal"] = null;
  if (totals.length) {
    const stated = totals[totals.length - 1];
    // A grand total adds the rows (or, with subtotals above it, the subtotals).
    const read = totals.length > 1 && Math.abs(sum(totals.slice(0, -1)) - stated) <= 0.01 ? sum(totals.slice(0, -1)) : amountIn;
    fileTotal = { stated, read, ok: Math.abs(stated - read) <= 0.01 };
  }
  const ok = Math.abs(amountIn - amountOut - amountRejected) <= 0.005 && (fileTotal?.ok ?? true);
  return { records: records as Rec[], rejected, skipped, rowsRead, proof: { amountIn, amountOut, amountRejected, fileTotal, ok } };
}

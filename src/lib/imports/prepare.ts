import { readWorkbook } from "@/lib/ingest/read";
import type { Grid } from "@/lib/ingest/extract";
import { guessRole, type SheetRole } from "@/lib/ingest/roles";
import { describeColumns, findHeader, KIND_EXPORT, ODOO_TEMPLATES, type ExportKey, type ExportKind, type SavedMapping } from "@/lib/ingest/odoo-templates";
import { classifyLayers, locationClass, readOnHandSheet, readProducts, readStockMoves, readStockValuation, type LocationTypes, type RowIssue, type StockLayer, type StockMove } from "@/lib/ingest/inventory";

/**
 * What the background thread does with an upload, as plain functions (tested without a browser):
 *  - sampleFile: the first rows only, to show which Odoo export a file is, how its columns map, and a few rows as iReport
 *    reads them, before the whole file is read;
 *  - parseFiles: every row of every file, as the records the database stages (valid rows with their data, unreadable rows
 *    with their error), numbered so a chunk sent twice is stored once.
 */
export const SAMPLE_ROWS = 60;
const ROLE_EXPORT: Partial<Record<SheetRole, ExportKey>> = { stock_valuation: "stock.valuation.layer", stock_moves: "stock.move.line", stock_onhand: "product.product", products: "product.template" };

export interface FileSample {
  name: string; size: number; sheet: string; export: ExportKey | null; why: string; totalRows: number;
  columns: ReturnType<typeof describeColumns> | null;
  /** A few rows as iReport reads them (labels → text). */
  preview: Record<string, string>[];
  issues: RowIssue[];
  /** Exactly one page of Odoo's list view (80, 200 or 500 records): probably exported without "Select all". */
  pageSized?: boolean;
}

/** The page sizes of Odoo's list view: a file with exactly this many records is most likely one page, not all of them. */
export const ODOO_PAGE_SIZES = [80, 200, 500];

/** The first sheet with something in it (Odoo exports one sheet per file). */
const firstSheet = (grids: Grid[]) => grids.find((g) => g.rows.some((r) => r?.some((v) => v !== null && v !== ""))) ?? grids[0];

export async function sampleFile(name: string, data: ArrayBuffer, saved: Partial<Record<ExportKey, SavedMapping>> = {}, forced?: ExportKey | null): Promise<FileSample> {
  const grids = await readWorkbook(data, name, { sheetRows: SAMPLE_ROWS });
  const g = firstSheet(grids);
  const base = { name, size: data.byteLength, sheet: g?.name ?? "", totalRows: g ? Math.max(0, (g.totalRows ?? g.rows.length) - 1) : 0 };
  if (!g) return { ...base, export: null, why: "The file has no sheet.", columns: null, preview: [], issues: [] };
  // Odoo exports one list per file; a workbook with several filled sheets is not one export.
  if (grids.filter((x) => x.rows.some((r) => r?.some((v) => v !== null && v !== ""))).length > 1)
    return { ...base, export: null, why: "This workbook has several sheets. Upload each Odoo export as its own file, as Odoo saves it.", columns: null, preview: [], issues: [] };
  const guess = guessRole(g);
  const key = forced ?? ROLE_EXPORT[guess.role] ?? null;
  if (!key) return { ...base, export: null, why: "Not an Odoo Inventory export iReport knows (valuation, moves history, product variants, products).", columns: null, preview: [], issues: [] };
  const map = saved[key];
  const columns = describeColumns(g, key, map);
  const read = readKind(g, ODOO_TEMPLATES[key].kind, map, null, "");
  const h = findHeader(g, map);
  const records = (g.totalRows ?? g.rows.length) - (h ? h.r + 1 : 1);
  return { ...base, export: key, why: ODOO_TEMPLATES[key].title, columns, preview: read.preview.slice(0, 8), issues: read.issues.slice(0, 20), pageSized: ODOO_PAGE_SIZES.includes(records) };
}

type Read = { layers: StockLayer[]; moves: StockMove[]; onhand: { product: string; code: string; location: string; lot: string; qty: number; value: number | null }[]; products: ReturnType<typeof readProducts>; issues: RowIssue[]; skipped: number; withIds: boolean; preview: Record<string, string>[]; locationTypes?: LocationTypes };

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });
function readKind(g: Grid, kind: ExportKind, saved: SavedMapping | undefined, rentalLocation: string | null, asOf: string, tz: string | null = null, types?: LocationTypes): Read {
  const out: Read = { layers: [], moves: [], onhand: [], products: [], issues: [], skipped: 0, withIds: true, preview: [] };
  if (kind === "valuation") {
    const r = readStockValuation(g, saved, tz);
    if (r) { out.layers = r.layers; out.issues = r.issues; out.skipped = r.skipped; out.withIds = r.withIds; }
    out.preview = out.layers.slice(0, 8).map((l) => ({ Date: l.day, Product: l.code ? `[${l.code}] ${l.product}` : l.product, Reference: l.ref, Kind: l.kind, Quantity: fmt(l.qty), Value: fmt(l.value), ...(l.updated ? { "Last updated": l.updated } : {}) }));
  } else if (kind === "moves") {
    const r = readStockMoves(g, rentalLocation, saved, tz, types);
    if (r) { out.moves = r.moves; out.issues = r.issues; out.skipped = r.skipped; out.withIds = r.withIds; out.locationTypes = r.locationTypes; }
    out.preview = out.moves.slice(0, 8).map((m) => ({ Date: m.day, Product: m.code ? `[${m.code}] ${m.product}` : m.product, Reference: m.ref, Kind: m.kind, From: m.from, To: m.to, Quantity: fmt(m.qty) }));
  } else if (kind === "onhand") {
    const r = readOnHandSheet(g, asOf || "2000-01-01", saved);
    if (r) { out.onhand = r.rows; out.issues = r.issues; out.skipped = r.skipped; }
    out.preview = out.onhand.slice(0, 8).map((o) => ({ Product: o.code ? `[${o.code}] ${o.product}` : o.product, Location: o.location || "All warehouses", Quantity: fmt(o.qty), Value: o.value === null ? "" : fmt(o.value) }));
  } else {
    out.products = readProducts(g, saved) ?? [];
    out.preview = (out.products ?? []).slice(0, 8).map((p) => ({ Code: p.code, Name: p.name, Category: p.category, Cost: p.cost === null ? "" : fmt(p.cost) }));
  }
  return out;
}

/** One staged record: a valid row's data, or an unreadable row's error. */
export interface StagedRecord { n: number; line: number | null; data?: Record<string, unknown>; error?: string }
export interface ParsedFile { name: string; export: ExportKey; kind: ExportKind; records: StagedRecord[]; valid: number; invalid: number; skipped: number; withIds: boolean; months: string[]; value: number; /** Rows dated after the cut-off, left out. */ afterCutoff?: number }
export interface ParseResult { files: ParsedFile[]; locations: string[]; /** Odoo's own location types, from the moves export. */ locationTypes?: LocationTypes }

const cut = (s: string | undefined, n: number) => (s ?? "").slice(0, n);
const lineOf = (g: Grid, row?: number) => (row === undefined ? null : row + 1 + (g.origin?.r ?? 0));

/** Every row of every file, ready to stage. Valuation rows take their kind from the moves read in the same upload. */
export async function parseFiles(files: { name: string; data: ArrayBuffer; export: ExportKey; mapping?: SavedMapping }[], opts: { rentalLocation: string | null; asOf: string; timeZone?: string | null; cutoff?: string | null; locationTypes?: LocationTypes }, progress?: (done: number, of: number) => void): Promise<ParseResult> {
  const read: { f: (typeof files)[number]; g: Grid; r: Read; late: number }[] = [];
  for (const [i, f] of files.entries()) {
    const g = firstSheet(await readWorkbook(f.data, f.name));
    const r = readKind(g, ODOO_TEMPLATES[f.export].kind, f.mapping, opts.rentalLocation, opts.asOf, opts.timeZone ?? null, opts.locationTypes);
    // Layers and moves after the cut-off are left out; stock on hand is the count on the day it was exported.
    const c = opts.cutoff, n = r.layers.length + r.moves.length;
    if (c) { r.layers = r.layers.filter((l) => l.day <= c); r.moves = r.moves.filter((m) => m.day <= c); }
    read.push({ f, g, r, late: n - r.layers.length - r.moves.length });
    progress?.(i + 1, files.length);
  }
  const allMoves = read.flatMap((x) => x.r.moves);
  const out: ParsedFile[] = read.map(({ f, g, r, late }) => {
    const kind = ODOO_TEMPLATES[f.export].kind;
    const rows: { line: number | null; data?: Record<string, unknown>; error?: string }[] = [];
    if (kind === "valuation") {
      for (const l of allMoves.length ? classifyLayers(r.layers, allMoves) : r.layers) rows.push({ line: lineOf(g, l.src?.row), data: {
        odoo_key: cut(l.key, 200), day: l.day, period: l.period, ref: cut(l.ref, 120), kind: l.kind, product: cut(l.product, 300), code: cut(l.code, 120),
        category: cut(l.category, 200), lot: cut(l.lot, 120), qty: l.qty, unit_value: l.unitValue, value: l.value, partner: cut(l.partner, 200), landed_ref: cut(l.landedRef, 120),
        ...(l.updated ? { updated_at: l.updated } : {}) } });
    } else if (kind === "moves") {
      for (const m of r.moves) rows.push({ line: lineOf(g, m.src?.row), data: {
        odoo_key: cut(m.key, 200), day: m.day, period: m.period, ref: cut(m.ref, 120), kind: m.kind, product: cut(m.product, 300), code: cut(m.code, 120),
        lot: cut(m.lot, 120), from_loc: cut(m.from, 200), to_loc: cut(m.to, 200), qty: m.qty, uom: cut(m.uom, 60), partner: cut(m.partner, 200),
        ...(m.updated ? { updated_at: m.updated } : {}) } });
    } else if (kind === "onhand") {
      for (const o of r.onhand) rows.push({ line: null, data: { as_of: opts.asOf, product: cut(o.product, 300), code: cut(o.code, 120), location: cut(o.location, 200), lot: cut(o.lot, 120), qty: o.qty, value: o.value } });
    } else {
      // Products are kept by their internal reference: one without it cannot be saved, and the job says so by name.
      for (const p of r.products ?? []) rows.push(p.code
        ? { line: null, data: { code: cut(p.code, 120), name: cut(p.name, 300), category: cut(p.category, 200), cost: p.cost, type: cut(p.type, 60) } }
        : { line: null, error: cut(`${p.name || "A product"} has no internal reference: products are kept by it, so this one is not saved. Add it in Odoo and export again.`, 300) });
    }
    for (const i of r.issues) rows.push({ line: i.line, error: cut(i.message, 300) });
    // In sheet order, so a person reading the errors finds each row where it is.
    rows.sort((a, b) => (a.line ?? Infinity) - (b.line ?? Infinity));
    const months = [...new Set([...r.layers, ...r.moves].map((x) => x.period))].sort();
    return {
      name: f.name, export: f.export, kind, records: rows.map((x, k) => ({ n: k + 1, ...x })), valid: rows.filter((x) => !x.error).length, invalid: rows.filter((x) => x.error).length,
      skipped: r.skipped, withIds: r.withIds, months, value: Math.round(r.layers.reduce((s, l) => s + l.value, 0) * 100) / 100, ...(late ? { afterCutoff: late } : {}),
    };
  });
  const locations = [...new Set(allMoves.flatMap((m) => [m.from, m.to]))].filter((l) => l && (locationClass(l) !== "partner" && (locationClass(l) !== "virtual" || /rental|تأجير|إيجار|ايجار/i.test(l)))).sort();
  const found = Object.assign({}, ...read.map((x) => x.r.locationTypes ?? {})) as LocationTypes;
  return { files: out, locations, ...(Object.keys(found).length ? { locationTypes: found } : {}) };
}

export { KIND_EXPORT };

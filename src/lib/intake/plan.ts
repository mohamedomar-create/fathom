// The whole upload, every tab: Odoo's own reports read by their readers, every other table split, understood, mapped and
// read row by row, the tabs checked against each other. Every tab ends up a piece (with its module, or waiting for the
// person) or in the "left out" list with its reason; every row is kept, rejected or skipped on purpose.
import type { Grid } from "@/lib/ingest/extract";
import { parseDay } from "@/lib/ingest/parse";
import { otherOdooReport } from "@/lib/ingest/odoo-reports";
import { readAged, type AgedReport } from "@/lib/ingest/aged";
import { readPayments } from "@/lib/ingest/payments";
import { guessRole, type SheetRole } from "@/lib/ingest/roles";
import { moduleByKey } from "@/lib/modules/registry";
import { headingKey, mapPiece, type Mapping } from "./map";
import { readRecords, type ReadOut } from "./records";
import { splitGrid, pieceOf, type Piece } from "./split";
import { understand, type Band, type Guess } from "./understand";
import { latestDocDay, openItemsReport, titleAsOf } from "./open-items";
import { reconcile, type Reconciliation } from "./reconcile";
import { modulesNow } from "@/lib/modules/registry";
import { layoutKey, type SavedLayouts } from "./memory";

/** Layouts read whole by their own reader (an Odoo report, a ledger, a cash book), not as a list. */
export type LayoutSource = "odoo_aged" | "odoo_payments" | "statement" | "cashbook" | "bank" | "stock_valuation" | "stock_moves" | "stock_onhand" | "products";
const LAYOUT_ROLES = new Set<SheetRole>(["statement", "cashbook", "bank", "stock_valuation", "stock_moves", "stock_onhand", "products"]);

export interface PlannedPiece {
  id: string;
  sheet: string;
  title?: string;
  /** The module the table goes to; null while the person (or AI assist) hasn't placed it. */
  module: string | null;
  band: Band;
  why: string;
  /** Every module's score, best first (for the person's choice). */
  candidates: Guess[];
  /** A layout read whole by its own reader. */
  layout?: LayoutSource;
  map?: Mapping;
  read?: ReadOut;
  /** Open items as an ageing report (receivables / payables). */
  aged?: AgedReport;
  /** What the person must give before the piece can be saved ("as-of day" for open items with no date above them). */
  needs?: string[];
  /** For open items with no as-of day: the latest document date, offered for the person to confirm. */
  suggestedAsOf?: string | null;
  /** Placed and mapped the way the person did before for this layout. */
  remembered?: boolean;
  /** The remembered mapping (heading → field), kept when the person changes something else on the table. */
  savedMapping?: Record<string, string>;
  piece: Piece;
}
export interface IntakePlan {
  pieces: PlannedPiece[];
  left: { sheet: string; reason: string }[];
  checks: Reconciliation[];
  rows: { read: number; kept: number; rejected: number; skipped: number };
}

const figures = (g: Grid) => g.rows.some((r) => (r ?? []).some((v) => typeof v === "number" || (typeof v === "string" && /\d/.test(v) && /^[\s(\-]*[\d.,]+\)?\s*$/.test(v))));

/** One table placed in a module (the best guess, or the person's choice): mapped, read, and aged when it is open items. */
export function placePiece(piece: Piece, module: string | null, extra: Partial<PlannedPiece> = {}, opts: { saved?: Record<string, string>; override?: Record<number, string | null>; headerRow?: number; asOf?: string } = {}): PlannedPiece {
  const u = understand(piece);
  const m = module ? moduleByKey(module) : null;
  const base: PlannedPiece = { id: piece.id, sheet: piece.sheet, title: piece.title, module: m?.key ?? null, band: u.band, why: u.best?.why ?? "No module fits this table well.", candidates: u.ranked, piece, ...extra };
  if (!m) return base;
  const map = mapPiece(piece, m, opts);
  // A snapshot list (staff, assets) without its own as-of column stands at the day the person gives, or a day above it.
  const undated = m.nature === "snapshot" && !(m.date && m.date in map.cols);
  const snapDay = undated ? opts.asOf ?? titleAsOf(piece.title, (s) => parseDay(s)) : null;
  const read = readRecords(piece, m, map, snapDay);
  const out: PlannedPiece = { ...base, map, read, why: u.ranked.find((g) => g.module === m.key)?.why ?? base.why };
  if (undated && !snapDay) { out.needs = ["as-of day"]; out.suggestedAsOf = null; }
  if (m.key === "ar_open" || m.key === "ap_open") {
    // The person's day first, then a day written above the list; a day guessed from the documents is only suggested.
    const asOf = opts.asOf ?? titleAsOf(piece.title, (s) => parseDay(s));
    if (asOf) out.aged = openItemsReport(read.records, m.key === "ar_open" ? "receivable" : "payable", asOf);
    else { out.needs = ["as-of day"]; out.suggestedAsOf = latestDocDay(read.records); }
  }
  return out;
}

/** A layout the person mapped before: the module and the mapping they chose, when one matches this table's headings. */
function rememberedFor(p: Piece, saved: SavedLayouts | undefined): { module: string; mapping: Record<string, string> } | null {
  if (!saved) return null;
  for (const m of modulesNow()) {
    const map = mapPiece(p, m, {});
    const heads = (p.rows[map.headerRow] ?? []).map((v) => (v === null || v === undefined ? "" : String(v))).filter((h) => h.trim());
    const hit = saved[layoutKey(m.key, heads)];
    if (hit) return { module: m.key, mapping: hit };
  }
  // The headings row may not be one the module recognises on its own: try each of the first rows.
  for (let r = 0; r < Math.min(p.rows.length, 30); r++) {
    const heads = (p.rows[r] ?? []).map((v) => (v === null || v === undefined ? "" : String(v))).filter((h) => h.trim());
    if (heads.length < 2) continue;
    for (const m of modulesNow()) { const hit = saved[layoutKey(m.key, heads)]; if (hit) return { module: m.key, mapping: hit }; }
  }
  return null;
}

/** The row holding the remembered headings. */
function headerRowFor(p: Piece, mapping: Record<string, string>): number | undefined {
  const keys = new Set(Object.keys(mapping));
  for (let r = 0; r < Math.min(p.rows.length, 30); r++) {
    const heads = (p.rows[r] ?? []).filter((v) => v !== null && v !== undefined && String(v).trim()).map((v) => headingKey(String(v)));
    if (heads.length && heads.every((h) => keys.has(h))) return r;
  }
  return undefined;
}

export function planIntake(grids: Grid[], opts: { vat?: number; asOf?: string; saved?: SavedLayouts } = {}): IntakePlan {
  const pieces: PlannedPiece[] = [];
  const left: IntakePlan["left"] = [];
  for (const g of grids) {
    const whole = pieceOf(g);
    // Odoo's own reports first: their layouts are read whole by the readers built for them.
    const aged = readAged(g);
    if (aged) { pieces.push({ ...placePiece(whole, null), module: aged.side === "receivable" ? "ar_open" : "ap_open", band: "sure", why: `Odoo's Aged ${aged.side === "receivable" ? "Receivable" : "Payable"} report.`, layout: "odoo_aged", aged }); continue; }
    if (readPayments(g)) { pieces.push({ ...placePiece(whole, null), module: "payments", band: "sure", why: "Odoo's Customer / Vendor Payments list.", layout: "odoo_payments" }); continue; }
    const other = otherOdooReport(g);
    if (other) { left.push({ sheet: g.name, reason: `Odoo's ${other.title}: ${other.why}.` }); continue; }
    if (!figures(g)) { left.push({ sheet: g.name, reason: "No figures on this tab." }); continue; }
    // A ledger, trial balance or statement (debit and credit, accounts by month), a cash book or a bank statement: read
    // whole by its own step, with its own checks, never as a list.
    const role = guessRole(g);
    const parts = splitGrid(g);
    const known = parts.map((p) => ({ p, r: rememberedFor(p, opts.saved) }));
    if (known.some((k) => k.r)) {
      for (const { p, r } of known) pieces.push(r ? { ...placePiece(p, r.module, {}, { saved: r.mapping, asOf: opts.asOf, headerRow: headerRowFor(p, r.mapping) }), band: "sure", why: "Placed the way you placed this layout before.", remembered: true, savedMapping: r.mapping } : placePiece(p, null));
      continue;
    }
    const understood = parts.map((p) => ({ p, u: understand(p) }));
    // ...unless a list module is sure of a table on the tab (lists side by side can look like a cash book).
    if (role.sure && LAYOUT_ROLES.has(role.role) && !understood.some(({ u }) => u.band === "sure")) {
      pieces.push({ ...placePiece(whole, null), module: null, band: "sure", why: role.why, layout: role.role as LayoutSource });
      continue;
    }
    // Lists the modules recognise go to them; a tab none of them reads is offered to the layout readers whole.
    if (understood.some(({ u }) => u.band !== "unknown")) {
      for (const { p, u } of understood) pieces.push(placePiece(p, u.band === "unknown" ? null : u.best!.module, {}, { asOf: opts.asOf }));
      continue;
    }
    if (LAYOUT_ROLES.has(role.role)) { pieces.push({ ...placePiece(whole, null), module: null, band: "likely", why: role.why, layout: role.role as LayoutSource }); continue; }
    for (const { p } of understood) pieces.push(placePiece(p, null));
  }
  const listed = pieces.filter((p) => p.module && p.read);
  const checks = reconcile(listed.map((p) => ({ id: p.id, module: p.module!, records: p.read!.records })), opts);
  const rows = { read: 0, kept: 0, rejected: 0, skipped: 0 };
  for (const p of pieces) if (p.read) { rows.read += p.read.rowsRead; rows.kept += p.read.records.length; rows.rejected += p.read.rejected.length; rows.skipped += p.read.skipped.length; }
  return { pieces, left, checks, rows };
}

// What a table is: each module scores it from its headings (the required ones most), the fields only it has (a due date
// for open items, a product for sales), the tab's name, and the document numbers (BILL/… is the supplier side). The best
// score decides; how sure it is decides what the person is asked.
import type { Cell } from "@/lib/ingest/parse";
import { MODULES, fieldOf } from "@/lib/modules/registry";
import type { ModuleDef } from "@/lib/modules/types";
import { mapPiece, type Mapping } from "./map";
import type { Piece } from "./split";

/** At or above: taken as read. Between LIKELY and SURE: the person confirms. Below LIKELY: AI assist, or the person picks. */
export const SURE = 0.8;
export const LIKELY = 0.5;
export type Band = "sure" | "likely" | "unknown";

export interface Guess { module: string; score: number; why: string; map: Mapping }
export interface Understanding { band: Band; best: Guess | null; ranked: Guess[] }

const text = (v: Cell) => (v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim());
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const BILL = /^(bill|rbill|vb|vendor bill|in\/|فاتورة مورد)/i;
const INV = /^(inv|rinv|out\/|s\d|so\/)/i;
const DEBIT = /^(debit|dr|مدين|المدين)$/i;
const CREDIT = /^(credit|cr|دائن|الدائن)$/i;

/** How well a module fits a table, 0 to 1, with the reasons. */
export function recognise(m: ModuleDef, p: Piece): Guess {
  const map = mapPiece(p, m);
  const heads = (p.rows[map.headerRow] ?? []).map(text).filter(Boolean);
  const why: string[] = [];
  const req = m.required.length ? m.required.filter((g) => g.some((k) => k in map.cols)).length / m.required.length : 1;
  const sig = m.signature?.length ? m.signature.filter((g) => g.some((k) => k in map.cols)).length / m.signature.length : 1;
  const opt = m.fields.length ? Object.keys(map.cols).length / m.fields.length : 0;
  const name = m.sheetWords && (m.sheetWords.test(p.sheet) || (p.title ? m.sheetWords.test(p.title) : false)) ? 1 : 0;
  let score = 0.55 * req + 0.25 * sig + 0.1 * opt + 0.1 * name;
  if (req === 1) why.push(`has ${m.required.map((g) => g.map((k) => m.fields.find((f) => f.key === k)!.label.en).join(" or ")).join(", ")}`);
  else why.push(`missing ${map.missing.join(", ")}`);
  if (m.signature?.length && sig > 0) why.push(`${m.signature.flat().filter((k) => k in map.cols).map((k) => m.fields.find((f) => f.key === k)!.label.en.toLowerCase()).join(", ")} column`);
  if (name) why.push(`tab named "${p.sheet}"`);
  // A module that leaves columns unexplained fits less well than one that reads them all (a due date on a bills list).
  const unexplained = map.unmapped.filter((u) => u.why === "unknown").length;
  if (unexplained) score -= Math.min(0.15, 0.05 * unexplained);
  // Debit and credit columns make a ledger or a trial balance, not a list of documents.
  if (heads.some((h) => DEBIT.test(h)) && heads.some((h) => CREDIT.test(h))) { score -= 0.5; why.push("but it has debit and credit columns (a ledger)"); }
  const against = m.excludes ? heads.filter((h) => m.excludes!.test(h) && !fieldOf(m, h)) : [];
  if (against.length) { score -= 0.4; why.push(`but has "${against[0]}"`); }
  // Document numbers: mostly vendor bills or mostly invoices.
  if (m.docSide && m.doc && m.doc in map.cols) {
    const docs = p.rows.slice(map.headerRow + 1).map((r) => text(r?.[map.cols[m.doc!]])).filter(Boolean);
    if (docs.length >= 2) {
      const bills = docs.filter((d) => BILL.test(d)).length / docs.length, invs = docs.filter((d) => INV.test(d)).length / docs.length;
      const mine = m.docSide === "supplier" ? bills : invs, theirs = m.docSide === "supplier" ? invs : bills;
      if (mine >= 0.6) { score += 0.1; why.push(m.docSide === "supplier" ? "vendor bill numbers" : "invoice numbers"); }
      else if (theirs >= 0.6) { score -= 0.3; why.push(m.docSide === "supplier" ? "but the numbers are customer invoices" : "but the numbers are vendor bills"); }
    }
  }
  // Figures: a list module needs amounts in its rows.
  const hasNumbers = p.rows.slice(map.headerRow + 1).some((r) => (r ?? []).some((v) => typeof v === "number" || (typeof v === "string" && /\d/.test(v))));
  if (!hasNumbers) score *= 0.5;
  return { module: m.key, score: r3(Math.max(0, Math.min(1, score))), why: why.join("; "), map };
}

/** Every module's score for a table, best first. */
export function bestModules(p: Piece, modules: readonly ModuleDef[] = MODULES): Guess[] {
  return modules.map((m) => recognise(m, p)).sort((a, b) => b.score - a.score);
}

export function understand(p: Piece, modules: readonly ModuleDef[] = MODULES): Understanding {
  const ranked = bestModules(p, modules);
  const best = ranked[0] ?? null;
  // Two modules close together are never "sure": the person picks.
  const close = ranked[1] && best && best.score - ranked[1].score < 0.1;
  const band: Band = !best || best.score < LIKELY ? "unknown" : best.score >= SURE && !close ? "sure" : "likely";
  return { band, best: band === "unknown" ? null : best, ranked };
}

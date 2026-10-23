// A buying agency's statement as the company keeps it (e.g. the Unified Procurement Authority sheet: date, delivery
// note, invoice, hospital, funding type, region, value before VAT, VAT, collections, balance). It is read only to say
// which hospital each Odoo invoice was for: its values are never sales, and its collections and balances never
// receivables. Collection rows (no value) and the closing "End" row are not lines; the End row is checked against them.
import type { AgencyLine } from "@/lib/engine";
import type { Grid } from "./extract";
import { arRx, cleanNum, normAr, parseDay, type Cell } from "./parse";

type Field = "date" | "dn" | "ref" | "hospital" | "funding" | "region" | "value" | "vat" | "description";
const FIELDS: [Field, RegExp][] = [
  ["date", arRx(/^(date|التاريخ|تاريخ)$/i)],
  ["dn", arRx(/^(dn ?#?|dn no\.?|delivery note|اذن الصرف|رقم الاذن)$/i)],
  ["ref", arRx(/^(inv ?#?|inv(oice)? no\.?|invoice|رقم الفاتوره|الفاتوره)$/i)],
  ["hospital", arRx(/^(name( \( ?\))?|hospital|customer|end user|المستشفي|الجهه|الاسم)$/i)],
  ["funding", arRx(/^(type|funding|نوع التمويل|النوع)$/i)],
  ["region", arRx(/^(area|region|المنطقه)$/i)],
  ["value", arRx(/^(value|net|amount before vat|القيمه|القيمه قبل الضريبه)$/i)],
  ["vat", arRx(/^(vat|الضريبه|ضريبه القيمه المضافه)$/i)],
  ["description", arRx(/^(descri(b|p)tion|البيان|الوصف)$/i)],
];
export type AgencyField = Field;
export const agencyFieldOf = (c: Cell): Field | null => {
  const t = normAr(String(c ?? "").replace(/\s+/g, " ").trim());
  return FIELDS.find(([, rx]) => rx.test(t))?.[0] ?? null;
};
const text = (c: Cell) => (c === null || c === undefined ? "" : String(c).replace(/\s+/g, " ").trim());

export interface AgencyStatement {
  sheet: string;
  lines: AgencyLine[];
  /** Sum of the lines read (before tax). */
  total: number;
  beforeStart: { lines: number; value: number };
  /** Things a person should look at; none of them stops the reading. */
  issues: string[];
}

/** The statement in a sheet, or null when the sheet has no date, hospital and value headings. */
export function readAgencyStatement(g: Grid, opts: { booksStart?: string | null } = {}): AgencyStatement | null {
  const hi = g.rows.slice(0, 30).findIndex((r) => {
    const f = new Set((r ?? []).map(agencyFieldOf));
    return f.has("date") && f.has("hospital") && f.has("value") && (f.has("dn") || f.has("ref"));
  });
  if (hi < 0) return null;
  const col = new Map<Field, number>();
  (g.rows[hi] ?? []).forEach((c, i) => { const f = agencyFieldOf(c); if (f && !col.has(f)) col.set(f, i); });
  const at = (r: Cell[], f: Field) => (col.has(f) ? r[col.get(f)!] : null);
  const lines: AgencyLine[] = [];
  const issues: string[] = [];
  const before = { lines: 0, value: 0 };
  const dns = new Map<string, number>();
  let endValue: number | null = null, noHospital = 0, badVat = 0, undated = 0;
  for (let i = hi + 1; i < g.rows.length; i++) {
    const r = g.rows[i] ?? [];
    if (/^end$/i.test(text(at(r, "date"))) || /^end$/i.test(text(at(r, "hospital")))) { endValue = cleanNum(at(r, "value")); continue; }
    const value = cleanNum(at(r, "value"));
    const day = parseDay(at(r, "date"));
    if (value === null || value === 0) continue; // collection rows and blank rows
    if (!day) { undated++; continue; }
    const hospital = text(at(r, "hospital"));
    if (!hospital) { noHospital++; continue; }
    const vat = cleanNum(at(r, "vat"));
    if (vat !== null && Math.abs(vat - value * 0.14) > Math.max(2, Math.abs(value) * 0.005)) badVat++;
    if (opts.booksStart && day < opts.booksStart) { before.lines++; before.value += value; continue; }
    const dn = text(at(r, "dn"));
    lines.push({ day, dn, ref: text(at(r, "ref")), hospital, funding: text(at(r, "funding")), region: text(at(r, "region")).toLowerCase(), value: Math.round(value * 100) / 100, sheet: g.name });
    if (dn) dns.set(`${dn}|${value}`, (dns.get(`${dn}|${value}`) ?? 0) + 1);
  }
  const total = Math.round(lines.reduce((s, l) => s + l.value, 0) * 100) / 100;
  if (endValue !== null && Math.abs(endValue - (total + before.value)) > 1) issues.push(`The End row says ${endValue}, but the lines read add up to ${Math.round((total + before.value) * 100) / 100}.`);
  if (noHospital) issues.push(`${noHospital} line${noHospital === 1 ? " has" : "s have"} a value but no hospital and ${noHospital === 1 ? "was" : "were"} not read.`);
  if (undated) issues.push(`${undated} line${undated === 1 ? " has" : "s have"} a value but no readable date and ${undated === 1 ? "was" : "were"} not read.`);
  if (badVat) issues.push(`${badVat} line${badVat === 1 ? "'s" : "s'"} VAT is not 14% of the value.`);
  const dup = [...dns].filter(([, n]) => n > 1).length;
  if (dup) issues.push(`${dup} delivery note${dup === 1 ? " appears" : "s appear"} more than once with the same value.`);
  return { sheet: g.name, lines, total, beforeStart: { lines: before.lines, value: Math.round(before.value * 100) / 100 }, issues };
}

/**
 * The lines of the sheets picked, as one list. A delivery note names one delivery, so the same note (with the same day,
 * value and hospital) on two sheets counts once; lines without a delivery note are all kept, since two real deliveries can
 * look alike. `merged` is how many lines were counted once.
 */
export function mergeStatementLines(reads: AgencyStatement[], picked: Set<string>): { lines: AgencyLine[]; merged: number } {
  const seen = new Set<string>();
  const lines: AgencyLine[] = [];
  let merged = 0;
  for (const l of reads.filter((r) => picked.has(r.sheet)).flatMap((r) => r.lines)) {
    if (l.dn) {
      const k = `${l.day}|${l.value}|${l.hospital}|${l.dn}`;
      if (seen.has(k)) { merged++; continue; }
      seen.add(k);
    }
    lines.push(l);
  }
  return { lines, merged };
}

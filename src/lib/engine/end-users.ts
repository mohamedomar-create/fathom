// The end user behind sales billed to a buying agency. Egypt's Unified Procurement Authority (الهيئة المصرية للشراء
// الموحد) is invoiced for goods each hospital ordered and received, so the invoice's customer is the agency, never the
// hospital. The hospital is taken only from an exact link: the invoice line's own sales order (its customer), the contact
// the invoice was addressed to, its delivery address, or the company's order register (agency order number → hospital).
// A line with none of them is Unmapped and is shown as such: it is never spread across hospitals by amount or share.

/** How a line's end user was found, most trusted first ("" = no link: Unmapped unless the register places it). */
export type EndUserMethod = "order" | "contact" | "shipping" | "";

/** Agency sales added up by month, billed customer, end user (as Odoo names it), method and category. */
export interface EndUserRow {
  p: string;
  /** The billed customer (the agency, for agency sales). */
  c: string;
  /** The end user as linked in Odoo ("" when there is no link). */
  u: string;
  m: EndUserMethod;
  g: string;
  /** Unlinked lines only: their description, where an agency order number can be read (e.g. "( PRO 501 / 22 ) - …"). */
  o: string;
  a: number;
  q: number;
  n: number;
}

export interface EndUserMaps {
  agencies: string[];
  /** hospitalKey(name) → the hospital it is (a person's merge of two spellings or two contacts). */
  aliases: Record<string, string>;
  /** Agency order number, as it appears in line descriptions ("PRO 501/22") → hospital. */
  register: Record<string, string>;
}

export interface EndUserMonth { period: string; total: number; order: number; contact: number; shipping: number; register: number; unmapped: number }
export interface Hospital { key: string; name: string; amount: number; qty: number; lines: number; byPeriod: Record<string, number>; byCategory: Record<string, number> }
export interface EndUserAnalysis {
  agencies: string[];
  total: number;
  /** Share of agency sales placed on a hospital; null when there are no agency sales. */
  coverage: number | null;
  months: EndUserMonth[];
  hospitals: Hospital[];
  unmapped: { text: string; amount: number; lines: number; months: string[] }[];
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const normAr = (s: string) => s.replace(/[ؐ-ًؚ-ٰٟـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي");
/** "…-الشراء الموحد", "…(الشراء الموحد)", "… - UPA": the agency's mark on a hospital contact. */
const AGENCY_MARK = /\s*[-–(]?\s*(?:ال|لل)?شراء\s+الموحد\s*\)?\s*$|\s*[-–(]\s*UPA\s*\)?\s*$/i;

/** A hospital's name without the agency's mark; an agency child contact ("<agency> (hospital)") gives the bracketed hospital. */
export function cleanHospital(name: string, agency?: string): string {
  let s = name.replace(/\s+/g, " ").trim();
  if (agency) {
    const a = agency.replace(/\s+/g, " ").trim();
    if (s.startsWith(a) && s.length > a.length) s = s.slice(a.length).replace(/^[\s\-–(]+|[\s)]+$/g, "");
  }
  for (let i = 0; i < 2 && AGENCY_MARK.test(s); i++) s = s.replace(AGENCY_MARK, "").trim();
  return s.replace(/[\s\-–]+$/, "").trim();
}

/** One key for one hospital however it is spelled: agency mark off, Arabic letters unified, spacing and case ignored. */
export const hospitalKey = (name: string) => normAr(cleanHospital(name)).replace(/[\s\-–_.,()]+/g, " ").trim().toLowerCase();

/**
 * Agencies: customers whose linked lines go to at least three end users other than themselves, for most of their linked
 * value. The company's own list adds or removes one.
 */
export function detectAgencies(rows: EndUserRow[], own: { add: string[]; remove: string[] } = { add: [], remove: [] }): string[] {
  const by = new Map<string, { other: number; linked: number; users: Set<string> }>();
  for (const r of rows) {
    if (!r.u) continue;
    const s = by.get(r.c) ?? { other: 0, linked: 0, users: new Set<string>() };
    const k = hospitalKey(r.u);
    s.linked += Math.abs(r.a);
    if (k !== hospitalKey(r.c)) { s.other += Math.abs(r.a); s.users.add(k); }
    by.set(r.c, s);
  }
  const auto = [...by].filter(([, s]) => s.users.size >= 3 && s.other >= s.linked / 2).map(([c]) => c);
  return [...new Set([...auto, ...own.add])].filter((c) => !own.remove.includes(c)).sort();
}

const refKey = (s: string) => normAr(s).replace(/\s+/g, "").toLowerCase();

export function endUserAnalysis(rows: EndUserRow[], maps: EndUserMaps): EndUserAnalysis {
  const agencies = new Set(maps.agencies);
  const register = Object.entries(maps.register).map(([k, h]) => [refKey(k), h] as const).filter(([k]) => k.length >= 3);
  const months = new Map<string, EndUserMonth>();
  const hospitals = new Map<string, Hospital>();
  // Each spelling's sales: a hospital is named as its largest spelling, whichever line came first.
  const spellings = new Map<string, Map<string, number>>();
  const unmapped = new Map<string, { text: string; amount: number; lines: number; months: Set<string> }>();
  let total = 0, placed = 0;
  for (const r of rows) {
    if (!agencies.has(r.c)) continue;
    const m = months.get(r.p) ?? { period: r.p, total: 0, order: 0, contact: 0, shipping: 0, register: 0, unmapped: 0 };
    months.set(r.p, m);
    m.total += r.a; total += r.a;
    let name = r.u ? cleanHospital(r.u, r.c) : "";
    let how: keyof Omit<EndUserMonth, "period" | "total"> = r.m || "unmapped";
    if (!name) {
      const text = refKey(r.o);
      const hit = text ? register.find(([k]) => text.includes(k)) : undefined;
      if (hit) { name = hit[1]; how = "register"; } else how = "unmapped";
    }
    m[how] += r.a;
    if (how === "unmapped") {
      const t = r.o.trim() || "(no description)";
      const u = unmapped.get(t) ?? { text: t, amount: 0, lines: 0, months: new Set<string>() };
      u.amount += r.a; u.lines += r.n; u.months.add(r.p);
      unmapped.set(t, u);
      continue;
    }
    placed += r.a;
    const alias = maps.aliases[hospitalKey(name)];
    if (alias) name = alias;
    const key = hospitalKey(name);
    const h = hospitals.get(key) ?? { key, name: "", amount: 0, qty: 0, lines: 0, byPeriod: {}, byCategory: {} };
    const sp = spellings.get(key) ?? new Map<string, number>();
    sp.set(cleanHospital(name), (sp.get(cleanHospital(name)) ?? 0) + Math.abs(r.a));
    spellings.set(key, sp);
    h.amount += r.a; h.qty += r.q; h.lines += r.n;
    h.byPeriod[r.p] = (h.byPeriod[r.p] ?? 0) + r.a;
    h.byCategory[r.g] = (h.byCategory[r.g] ?? 0) + r.a;
    hospitals.set(key, h);
  }
  const round = (m: EndUserMonth): EndUserMonth => ({ period: m.period, total: r2(m.total), order: r2(m.order), contact: r2(m.contact), shipping: r2(m.shipping), register: r2(m.register), unmapped: r2(m.unmapped) });
  return {
    agencies: [...agencies].sort(),
    total: r2(total),
    coverage: total ? placed / total : null,
    months: [...months.values()].sort((a, b) => a.period.localeCompare(b.period)).map(round),
    hospitals: [...hospitals.values()].map((h) => ({ ...h, name: [...(spellings.get(h.key) ?? [])].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0] ?? h.key, amount: r2(h.amount) })).sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name)),
    unmapped: [...unmapped.values()].map((u) => ({ text: u.text, amount: r2(u.amount), lines: u.lines, months: [...u.months].sort() })).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)),
  };
}

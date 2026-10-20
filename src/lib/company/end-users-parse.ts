import { applyStatement, detectAgencies, endUserAnalysis, matchStatement, unlinkedInvoices, type EndUserMaps, type EndUserMethod, type EndUserRow, type AgencyLine } from "@/lib/engine";

export interface EndUserData {
  rows: EndUserRow[];
  /** The company's own choices, as stored (kind, key, hospital). */
  choices: { kind: "alias" | "order" | "agency" | "not_agency"; key: string; hospital: string }[];
  /** The agency's own statement (hospital, funding, region per delivery), when one was uploaded. */
  statement: AgencyLine[];
  statementFile: { filename: string; sheets: string[]; at: string } | null;
}
export type EndUserRowIn = EndUserRow & { day?: string };
export const EMPTY_END_USERS: EndUserData = { rows: [], choices: [], statement: [], statementFile: null };

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : 0);
const METHODS = new Set(["order", "contact", "shipping"]);
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const KINDS = new Set(["alias", "order", "agency", "not_agency"]);

/** The database summary made safe: unknown methods read as no link, amounts that are not numbers as 0. */
export function parseEndUsers(raw: unknown): EndUserData {
  if (!raw || typeof raw !== "object") return EMPTY_END_USERS;
  const o = raw as { rows?: Record<string, unknown>[]; map?: Record<string, unknown>[]; statement?: Record<string, unknown>[]; statementFile?: Record<string, unknown> | null };
  return {
    rows: (Array.isArray(o.rows) ? o.rows : []).map((r) => ({
      p: String(r.p ?? ""), c: String(r.c ?? ""), u: String(r.u ?? ""), m: (METHODS.has(String(r.m)) ? String(r.m) : "") as EndUserMethod,
      g: String(r.g ?? ""), o: String(r.o ?? ""), a: num(r.a), q: num(r.q), n: num(r.n),
      ...(r.d ? { d: String(r.d) } : {}), ...(/^\d{4}-\d{2}-\d{2}$/.test(str(r.day)) ? { day: str(r.day) } : {}),
    })).filter((r) => /^\d{4}-\d{2}$/.test(r.p)),
    choices: (Array.isArray(o.map) ? o.map : []).filter((m) => KINDS.has(String(m.k))).map((m) => ({ kind: String(m.k) as EndUserData["choices"][number]["kind"], key: String(m.key ?? ""), hospital: String(m.h ?? "") })),
    statement: (Array.isArray(o.statement) ? o.statement : []).map((l) => ({ day: str(l.day).slice(0, 10), dn: str(l.dn), ref: str(l.ref), hospital: str(l.h), funding: str(l.f), region: str(l.r), value: num(l.v), sheet: str(l.s) }))
      .filter((l) => /^\d{4}-\d{2}-\d{2}$/.test(l.day) && l.hospital),
    statementFile: o.statementFile && typeof o.statementFile === "object" ? { filename: str(o.statementFile.filename), sheets: Array.isArray(o.statementFile.sheets) ? o.statementFile.sheets.map(str) : [], at: str(o.statementFile.at) } : null,
  };
}

/**
 * Everything the end-user pages show, from the summary: agencies, the agency statement matched to the invoices Odoo
 * has no link for (Odoo's amounts only), and the analysis. One place, so both pages say the same.
 */
export function resolveEndUsers(d: EndUserData, statement: AgencyLine[] = d.statement) {
  const maps = mapsOf(d, (own) => detectAgencies(d.rows, own));
  const match = matchStatement(statement, unlinkedInvoices(d.rows as EndUserRowIn[], maps.agencies));
  const rows = statement.length ? applyStatement(d.rows, match) : d.rows;
  return { maps, match, rows, analysis: endUserAnalysis(rows, maps) };
}

/** The company's choices as the engine takes them; agencies are the automatic ones plus or minus the company's own. */
export function mapsOf(d: EndUserData, detect: (own: { add: string[]; remove: string[] }) => string[]): EndUserMaps {
  const of = (k: string) => d.choices.filter((c) => c.kind === k);
  return {
    agencies: detect({ add: of("agency").map((c) => c.key), remove: of("not_agency").map((c) => c.key) }),
    aliases: Object.fromEntries(of("alias").map((c) => [c.key, c.hospital])),
    register: Object.fromEntries(of("order").map((c) => [c.key, c.hospital])),
  };
}

/** "PRO 501/22 = Minya Hospital" (or a tab / comma between them), one per line → order-register entries. */
export function parseRegister(text: string): { key: string; hospital: string }[] {
  return text.split(/\r?\n/).map((l) => l.split(/\s*(?:=|\t|;|,(?=[^,]*$))\s*/)).filter((p) => p.length >= 2 && p[0].trim() && p.slice(1).join(" ").trim())
    .map((p) => ({ key: p[0].trim().slice(0, 200), hospital: p.slice(1).join(" ").trim().slice(0, 200) }));
}

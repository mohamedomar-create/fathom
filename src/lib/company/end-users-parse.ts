import type { EndUserMaps, EndUserMethod, EndUserRow } from "@/lib/engine";

export interface EndUserData {
  rows: EndUserRow[];
  /** The company's own choices, as stored (kind, key, hospital). */
  choices: { kind: "alias" | "order" | "agency" | "not_agency"; key: string; hospital: string }[];
}
export const EMPTY_END_USERS: EndUserData = { rows: [], choices: [] };

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : 0);
const METHODS = new Set(["order", "contact", "shipping"]);
const KINDS = new Set(["alias", "order", "agency", "not_agency"]);

/** The database summary made safe: unknown methods read as no link, amounts that are not numbers as 0. */
export function parseEndUsers(raw: unknown): EndUserData {
  if (!raw || typeof raw !== "object") return EMPTY_END_USERS;
  const o = raw as { rows?: Record<string, unknown>[]; map?: Record<string, unknown>[] };
  return {
    rows: (Array.isArray(o.rows) ? o.rows : []).map((r) => ({
      p: String(r.p ?? ""), c: String(r.c ?? ""), u: String(r.u ?? ""), m: (METHODS.has(String(r.m)) ? String(r.m) : "") as EndUserMethod,
      g: String(r.g ?? ""), o: String(r.o ?? ""), a: num(r.a), q: num(r.q), n: num(r.n),
    })).filter((r) => /^\d{4}-\d{2}$/.test(r.p)),
    choices: (Array.isArray(o.map) ? o.map : []).filter((m) => KINDS.has(String(m.k))).map((m) => ({ kind: String(m.k) as EndUserData["choices"][number]["kind"], key: String(m.key ?? ""), hospital: String(m.h ?? "") })),
  };
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

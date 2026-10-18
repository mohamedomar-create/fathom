// When a live Odoo connection may be saved, judged on what Odoo itself reported at the test. Checked on the server at
// save time (the browser's copy of the test is never trusted).
import type { OdooProbe } from "./sync";

export type Role = "admin" | "editor" | "viewer";
const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };
export const atLeast = (role: Role | null, min: Role) => role !== null && RANK[role] >= RANK[min];

export interface Verdict { ok: boolean; reason: string | null; note: string }

/**
 * Save only a read-only Odoo user that sees the chosen company, and only that company (its branches too when branches
 * are included). A user Odoo won't describe needs an explicit "I accept" from the admin.
 */
export function connectionVerdict(p: Pick<OdooProbe, "rights" | "canChange" | "user" | "companies">, odooCompanyId: number, includeBranches: boolean, acceptUnverified = false): Verdict {
  const note = `Odoo user "${p.user.name}": rights ${p.rights}${p.canChange.length ? ` (can change ${p.canChange.join(", ")})` : ""}; companies ${p.user.companies.join(", ")}.`;
  if (p.rights === "write") return { ok: false, note, reason: `This Odoo user can change accounting data (${p.canChange.join(", ")}). Create a user with Accounting "Read-only" access only, make an API key for it, and use that.` };
  if (p.rights === "unknown" && !acceptUnverified) return { ok: false, note, reason: "Odoo did not confirm this user is read-only. Use a user with Accounting \"Read-only\" access, or tick \"I accept the risk\" to save anyway." };
  if (!p.user.companies.includes(odooCompanyId)) return { ok: false, note, reason: "This Odoo user cannot see the chosen company. Pick one of its companies, or give it access in Odoo." };
  const others = p.user.companies.filter((c) => c !== odooCompanyId);
  if (others.length && !includeBranches) {
    const names = others.map((c) => p.companies.find((x) => x.id === c)?.name ?? `#${c}`);
    return { ok: false, note, reason: `This Odoo user can also see ${names.join(", ")}. In Odoo, limit its Allowed companies to the chosen company only (or tick "Include branches" if those are its branches).` };
  }
  return { ok: true, reason: null, note };
}

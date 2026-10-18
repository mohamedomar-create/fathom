// When a live Odoo connection may be saved, judged on what Odoo itself reported at the test. Checked on the server at
// save time (the browser's copy of the test is never trusted).
import type { OdooProbe } from "./sync";
import type { ClassKey } from "@/lib/engine";
import { runChecks } from "@/lib/company/checks";

export type Role = "admin" | "editor" | "viewer";
const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };
export const atLeast = (role: Role | null, min: Role) => role !== null && RANK[role] >= RANK[min];

export interface Verdict { ok: boolean; reason: string | null; note: string; warnings: string[] }

/**
 * Any Odoo user with API access may connect (the owner's choice): iReport only ever sends reading requests, whatever the
 * user's rights. What the user could do in Odoo is reported as warnings and logged. The only refusal: a chosen company
 * the user can't see, since nothing could be read from it.
 */
export function connectionVerdict(p: Pick<OdooProbe, "rights" | "canChange" | "user" | "companies">, odooCompanyId: number, includeBranches: boolean): Verdict {
  const note = `Odoo user "${p.user.name}": rights ${p.rights}${p.canChange.length ? ` (can change ${p.canChange.join(", ")})` : ""}; companies ${p.user.companies.join(", ")}.`;
  if (!p.user.companies.includes(odooCompanyId)) return { ok: false, note, warnings: [], reason: "This Odoo user cannot see the chosen company. Pick one of its companies, or give it access in Odoo." };
  const warnings: string[] = [];
  if (p.rights === "write") warnings.push(`This Odoo user can change accounting data (${p.canChange.join(", ")}). iReport only reads, but if its API key were stolen it could be used to change your books: keep the key private and give it an end date.`);
  if (p.rights === "unknown") warnings.push("Odoo did not confirm what this user may change. iReport only reads.");
  const others = p.user.companies.filter((c) => c !== odooCompanyId);
  if (others.length && !includeBranches) warnings.push(`This Odoo user can also see ${others.map((c) => p.companies.find((x) => x.id === c)?.name ?? `#${c}`).join(", ")}. Only the chosen company is read.`);
  return { ok: true, reason: null, note, warnings };
}

/**
 * A sync is refused when its balance sheet doesn't balance in any month: with every account in, debits equal credits, so
 * a difference means an account was left out or placed outside the balance sheet. Null when it balances.
 */
export function unbalancedSync(accounts: { code: string; name: string; cls: ClassKey; amounts: Record<string, number> }[]): string | null {
  const off = runChecks({ accounts: accounts.map((a, i) => ({ ...a, id: String(i) })) }).filter((c) => c.id === "bs_balance" && c.severity === "block");
  if (!off.length) return null;
  return `The balance sheet from Odoo doesn't balance in ${off.length} month${off.length > 1 ? "s" : ""} (first: ${off[0].detail?.split(":")[1]?.split(".")[0]?.trim() ?? off[0].title}). Nothing was saved; an account is missing or placed outside the balance sheet. Check Chart of accounts.`;
}

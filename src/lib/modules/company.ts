// A company's modules: the built-in ones (on unless the company turned them off), the catalog modules it opened, and the
// ones it built. Who may see each one follows its row (a lowest role, plus named people), else the catalog default (HR and
// payroll: admins). The database enforces the same rule (private.module_visible); this only shapes what is shown.
import { CATALOG_KEYS } from "./catalog";
import { specToDef } from "./spec";
import type { ModuleDef } from "./types";

export interface CompanyModule {
  key: string; kind: "builtin" | "catalog" | "custom"; enabled: boolean; name: string | null;
  min_role: "admin" | "editor" | "viewer"; members: string[]; spec: unknown;
}

/** The modules that are on unless turned off (purchasing has always been open). */
export const BUILTIN = ["financials", "sales", "expenses", "inventory", "payments"] as const;
const OPEN_BY_DEFAULT = new Set<string>([...BUILTIN, "purchasing"]);
const ADMIN_ONLY = new Set(["hr", "payroll"]);
const RANK: Record<string, number> = { viewer: 1, editor: 2, admin: 3, owner: 4 };

/** Whether "who sees it" can be set: only for modules kept in the shared store, where the database enforces it. The
 *  built-in areas live in their own tables with company-level access, so a limit there would only hide the page. */
export function accessEditable(key: string): boolean {
  return !(BUILTIN as readonly string[]).includes(key);
}

export function isOn(key: string, rows: CompanyModule[]): boolean {
  const r = rows.find((x) => x.key === key);
  return r ? r.enabled : OPEN_BY_DEFAULT.has(key);
}

export function mayView(key: string, rows: CompanyModule[], role: string, userId: string | null | undefined): boolean {
  const r = rows.find((x) => x.key === key);
  const need = r ? r.min_role : ADMIN_ONLY.has(key) ? "admin" : "viewer";
  return (RANK[role] ?? 0) >= RANK[need] || (!!userId && !!r && r.members.includes(userId));
}

/** Catalog and custom modules the company opened and the person may see, in the order they were opened. */
export function openExtras(rows: CompanyModule[], role: string, userId: string | null | undefined): CompanyModule[] {
  return rows.filter((r) => r.enabled && r.key !== "purchasing" && (r.kind === "custom" || CATALOG_KEYS.includes(r.key)) && mayView(r.key, rows, role, userId));
}

/** The company's own modules as definitions the intake reads; a definition that no longer passes its schema is skipped. */
export function customDefs(rows: CompanyModule[]): ModuleDef[] {
  const out: ModuleDef[] = [];
  for (const r of rows) {
    if (r.kind !== "custom" || !r.enabled || !r.spec) continue;
    try { out.push(specToDef({ ...(r.spec as object), key: r.key } as never)); } catch { /* skipped: shown as "needs fixing" in Settings ▸ Modules */ }
  }
  return out;
}

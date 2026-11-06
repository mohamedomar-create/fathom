// Every module the intake can route a table to. A new module is added to DEFS; the wizard, checks and templates read it here.
import { normAr } from "@/lib/ingest/parse";
import { DEFS } from "./defs";
import { CATALOG } from "./catalog";
import type { ModuleDef } from "./types";

/** The built-in modules and the catalog (HR, CRM…): the same for every company. */
export const MODULES: readonly ModuleDef[] = [...DEFS, ...CATALOG];
const BY_KEY = new Map(MODULES.map((m) => [m.key, m]));
export const MODULE_KEYS = MODULES.map((m) => m.key);

// A company's own modules (built from its files), set in the browser for the company on screen. Never set on the server,
// which is shared between companies: server code passes a company's definitions explicitly.
let CUSTOM = new Map<string, ModuleDef>();
export function setCustomModules(defs: ModuleDef[]) { CUSTOM = new Map(defs.map((d) => [d.key, d])); }
/** Every module the intake can route to right now: the catalog plus the company's own. */
export const modulesNow = (): readonly ModuleDef[] => (CUSTOM.size ? [...MODULES, ...CUSTOM.values()] : MODULES);
export const moduleByKey = (key: string): ModuleDef | null => BY_KEY.get(key) ?? CUSTOM.get(key) ?? null;

/** A heading's field in a module: the module's own matcher (shared with its reader), else its field headings. */
export function fieldOf(m: ModuleDef, heading: string): string | null {
  const h = normAr(heading.replace(/\s*\*\s*$/, "").replace(/\s+/g, " ").trim());
  if (!h) return null;
  if (m.fieldOf) return m.fieldOf(h);
  return m.fields.find((f) => f.headings.test(h))?.key ?? null;
}

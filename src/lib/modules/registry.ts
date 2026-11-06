// Every module the intake can route a table to. A new module is added to DEFS; the wizard, checks and templates read it here.
import { normAr } from "@/lib/ingest/parse";
import { DEFS } from "./defs";
import type { ModuleDef } from "./types";

export const MODULES: readonly ModuleDef[] = DEFS;
const BY_KEY = new Map(MODULES.map((m) => [m.key, m]));
export const moduleByKey = (key: string): ModuleDef | null => BY_KEY.get(key) ?? null;
export const MODULE_KEYS = MODULES.map((m) => m.key);

/** A heading's field in a module: the module's own matcher (shared with its reader), else its field headings. */
export function fieldOf(m: ModuleDef, heading: string): string | null {
  const h = normAr(heading.replace(/\s*\*\s*$/, "").replace(/\s+/g, " ").trim());
  if (!h) return null;
  if (m.fieldOf) return m.fieldOf(h);
  return m.fields.find((f) => f.headings.test(h))?.key ?? null;
}

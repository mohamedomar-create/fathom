// A layout the person placed and mapped once is remembered for the company, keyed by the module and its headings, so the
// next upload of the same export goes through without questions. A layout that changed (a column added, renamed or
// gone) has another key: it is asked about again, never read with an old mapping.
import { headingKey } from "./map";

const fnv = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, "0"); };

/** The key a layout is remembered under (≤ 60 characters, the import_templates key). */
export function layoutKey(module: string, headings: string[]): string {
  const heads = headings.map((h) => headingKey(String(h ?? ""))).filter(Boolean).sort();
  return `intake:${module.slice(0, 30)}:${fnv(heads.join("|"))}`;
}
export const isIntakeKey = (k: string) => k.startsWith("intake:");
export type SavedLayouts = Record<string, Record<string, string>>;

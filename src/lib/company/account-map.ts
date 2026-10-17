import type { ClassKey } from "@/lib/engine";
import type { createClient } from "@/lib/supabase/server";

type Supa = Awaited<ReturnType<typeof createClient>>;
export type AccountMap = Record<string, ClassKey | "">;
export interface MapEntry { key: string; cls: ClassKey | ""; name: string }

/** A table or function the database does not have yet (its update not applied): treated as "nothing remembered". */
const missing = (e: { code?: string }) => e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST202";

/**
 * What an upload teaches the company's account map: the classes the person chose, by "#code" (or by name for an account
 * without a code). Row keys ("Sheet|row") belong to that one file and are not remembered.
 */
export function rememberedEntries(mapping: Record<string, string>, accounts: { code: string; name: string }[]): MapEntry[] {
  const nameOf = new Map(accounts.filter((a) => a.code).map((a) => [`#${a.code.trim()}`, a.name]));
  return Object.entries(mapping)
    .filter(([k]) => !k.includes("|") && k.length <= 200)
    .map(([key, cls]) => ({ key, cls: cls as ClassKey | "", name: (nameOf.get(key) ?? key).slice(0, 300) }));
}

/** The company's account map: every class a person has chosen, kept across uploads, Odoo syncs and the chart editor. */
export async function loadAccountMap(supabase: Supa, companyId: string): Promise<AccountMap> {
  const { data, error } = await supabase.from("account_map").select("key, cls").eq("company_id", companyId);
  if (error) { if (!missing(error)) console.error("account map: load failed", error.message); return {}; }
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.cls as ClassKey | ""]));
}

/** Remembers the person's choices. Never blocks the save it follows: a failure is logged. */
export async function rememberClasses(supabase: Supa, companyId: string, entries: MapEntry[]): Promise<void> {
  if (!entries.length) return;
  const { error } = await supabase.from("account_map").upsert(entries.map((e) => ({ company_id: companyId, key: e.key, cls: e.cls, name: e.name })), { onConflict: "company_id,key" });
  if (error && !missing(error)) console.error("account map: save failed", error.message);
}

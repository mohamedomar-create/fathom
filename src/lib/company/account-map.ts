import type { ClassKey } from "@/lib/engine";
import type { createClient } from "@/lib/supabase/server";

type Supa = Awaited<ReturnType<typeof createClient>>;
export type AccountMap = Record<string, ClassKey | "">;
export interface MapEntry { key: string; cls: ClassKey | ""; name: string }


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
  if (error) { console.error("account map: load failed", error.message); return {}; }
  // A row holding only a sub-class (cls null) is not a class choice.
  return Object.fromEntries((data ?? []).filter((r) => r.cls !== null).map((r) => [r.key, r.cls as ClassKey | ""]));
}

/** Remembers the person's choices. Never blocks the save it follows: a failure is logged. */
export async function rememberClasses(supabase: Supa, companyId: string, entries: MapEntry[]): Promise<void> {
  if (!entries.length) return;
  const { error } = await supabase.from("account_map").upsert(entries.map((e) => ({ company_id: companyId, key: e.key, cls: e.cls, name: e.name })), { onConflict: "company_id,key" });
  if (error) console.error("account map: save failed", error.message);
}

/** The sub-classes a person chose ("" = none), by the account map's key ("#code" or name). Empty when none or unreadable. */
export async function loadSubMap(supabase: Supa, companyId: string): Promise<Record<string, string>> {
  const { data, error } = await supabase.from("account_map").select("key, sub_class").eq("company_id", companyId).not("sub_class", "is", null);
  if (error) { console.error("account map: sub-classes failed", error.message); return {}; }
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.sub_class as string]));
}

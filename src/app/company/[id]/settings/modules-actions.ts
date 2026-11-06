"use server";
// Choosing a company's modules (0063): open or close one, build one from a file, and say who sees each. Admins only; the
// database checks the role again, records every change, and enforces who may read a module's rows.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { dbError } from "@/lib/action-error";
import type { Json } from "@/lib/supabase/database.types";
import { ModuleSpecSchema } from "@/lib/modules/spec";
import { MODULE_KEYS } from "@/lib/modules/registry";
import { BUILTIN } from "@/lib/modules/company";

type Result = { ok: true } | { ok: false; error: string };
const Id = z.string().uuid();
const Key = z.string().refine((k) => MODULE_KEYS.includes(k) || (BUILTIN as readonly string[]).includes(k) || /^c_[a-z0-9_]{1,37}$/.test(k), "unknown module");

async function session() {
  const { supabase, user } = await getUser();
  return user ? supabase : null;
}
const done = (companyId: string): Result => { revalidatePath(`/company/${companyId}`, "layout"); return { ok: true }; };

export async function setModuleOn(companyId: string, key: string, on: boolean): Promise<Result> {
  if (!Id.safeParse(companyId).success || !Key.safeParse(key).success) return { ok: false, error: "Unknown module." };
  const supabase = await session();
  if (!supabase) return { ok: false, error: "Please sign in again." };
  const { error } = await supabase.rpc("module_enable", { p_company: companyId, p_key: key, p_enabled: on });
  if (error) return { ok: false, error: dbError(error, "module_enable") };
  return done(companyId);
}

/** Every area at once, from the setup picker: the ones picked are opened, the built-in ones not picked are closed. */
export async function chooseModules(companyId: string, picked: string[]): Promise<Result> {
  const v = z.object({ c: Id, p: z.array(Key).max(40) }).safeParse({ c: companyId, p: picked });
  if (!v.success) return { ok: false, error: "Unknown module." };
  const supabase = await session();
  if (!supabase) return { ok: false, error: "Please sign in again." };
  const want = new Set(v.data.p);
  for (const k of [...BUILTIN, "purchasing", ...MODULE_KEYS.filter((k) => !["sales", "expenses", "ar_open", "ap_open", "payments", "purchasing"].includes(k))]) {
    const catalog = !(BUILTIN as readonly string[]).includes(k) && k !== "purchasing";
    // A catalog module not picked is simply left closed (no row); a built-in one not picked is turned off.
    if (catalog && !want.has(k)) continue;
    const { error } = await supabase.rpc("module_enable", { p_company: companyId, p_key: k, p_enabled: want.has(k) });
    if (error) return { ok: false, error: dbError(error, "module_enable") };
  }
  return done(companyId);
}

export async function saveCustomModule(companyId: string, spec: unknown): Promise<Result> {
  if (!Id.safeParse(companyId).success) return { ok: false, error: "Unknown company." };
  const v = ModuleSpecSchema.safeParse(spec);
  if (!v.success) return { ok: false, error: "The module is not complete: " + (v.error.issues[0]?.message ?? "check its fields") };
  if (!/^c_[a-z0-9_]{1,37}$/.test(v.data.key)) return { ok: false, error: "A module you build gets a key starting with c_." };
  const supabase = await session();
  if (!supabase) return { ok: false, error: "Please sign in again." };
  const { error } = await supabase.rpc("module_save_custom", { p_company: companyId, p_key: v.data.key, p_name: v.data.name.en, p_spec: v.data as unknown as Json });
  if (error) return { ok: false, error: dbError(error, "module_save_custom") };
  return done(companyId);
}

export async function setModuleAccess(companyId: string, key: string, minRole: "admin" | "editor" | "viewer", members: string[]): Promise<Result> {
  const v = z.object({ c: Id, k: Key, r: z.enum(["admin", "editor", "viewer"]), m: z.array(Id).max(200) }).safeParse({ c: companyId, k: key, r: minRole, m: members });
  if (!v.success) return { ok: false, error: "The access setting is not valid." };
  const supabase = await session();
  if (!supabase) return { ok: false, error: "Please sign in again." };
  const { error } = await supabase.rpc("module_set_access", { p_company: companyId, p_key: key, p_min_role: minRole, p_members: v.data.m });
  if (error) return { ok: false, error: dbError(error, "module_set_access") };
  return done(companyId);
}

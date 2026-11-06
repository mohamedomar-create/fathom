"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { dbError, safeError } from "@/lib/action-error";
import { limited, TOO_MANY } from "@/lib/rate-limit";
import type { Json } from "@/lib/supabase/database.types";
import { MODULE_KEYS } from "@/lib/modules/registry";

const Id = z.string().uuid();
const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Amount = z.number().finite().refine((v) => Math.abs(v) < 1e15, "amount out of range");
// Catalog keys, or a company's own (c_...): the database checks the company opened it and the person may see it.
const Module = z.string().refine((k) => MODULE_KEYS.includes(k) || /^c_[a-z0-9_]{1,37}$/.test(k), "unknown module");
const Value = z.union([z.string().max(300), Amount]);
const Row = z.object({ period: Period, day: Day.nullable(), doc: z.string().max(120), partner: z.string().max(200), amount: Amount, qty: Amount.nullable(), data: z.record(z.string().max(40), Value) });

type Fail = { ok: false; error: string };

/** Opens a staged save of a module's rows for these months (the shared store, 0062). */
export async function startModuleBatch(companyId: string, module: string, periods: string[], filename: string): Promise<{ ok: true; batch: string; staged: true } | Fail> {
  const v = z.object({ c: Id, m: Module, p: z.array(Period).min(1).max(600), f: z.string().max(300) }).safeParse({ c: companyId, m: module, p: periods, f: filename });
  if (!v.success) return { ok: false, error: "The save is not valid: " + v.error.issues[0]?.message };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (await limited(supabase, "module", user.id)) return { ok: false, error: TOO_MANY };
  const { data, error } = await supabase.rpc("module_batch_begin", { p_company: companyId, p_module: module, p_periods: v.data.p, p_filename: v.data.f });
  if (error) return { ok: false, error: dbError(error, "module_batch_begin") };
  return { ok: true, batch: data as string, staged: true };
}

export async function addModuleRows(companyId: string, batch: string, rows: z.input<typeof Row>[]): Promise<{ ok: true; saved: number } | Fail> {
  const v = z.object({ c: Id, b: Id, r: z.array(Row).min(1).max(5000) }).safeParse({ c: companyId, b: batch, r: rows });
  if (!v.success) return { ok: false, error: "A row is not valid: " + v.error.issues[0]?.message };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const { data, error } = await supabase.rpc("module_rows_add", { p_batch: batch, p_rows: v.data.r as unknown as Json });
  if (error) return { ok: false, error: dbError(error, "module_rows_add") };
  return { ok: true, saved: Number(data ?? 0) };
}

export async function finishModuleBatch(companyId: string, batch: string): Promise<{ ok: true; saved: number; sent: number } | Fail> {
  if (!Id.safeParse(companyId).success || !Id.safeParse(batch).success) return { ok: false, error: "The save is not valid." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  try {
    const { data, error } = await supabase.rpc("module_batch_finish", { p_batch: batch });
    if (error) return { ok: false, error: dbError(error, "module_batch_finish") };
    revalidatePath(`/company/${companyId}`, "layout");
    return { ok: true, saved: Number(data ?? 0), sent: Number(data ?? 0) };
  } catch (e) {
    return { ok: false, error: safeError(e, "finishModuleBatch") };
  }
}

/** Remembers how the person placed and mapped a layout (heading → field), so the next upload of it needs no questions. */
export async function rememberLayout(companyId: string, key: string, mapping: Record<string, string>): Promise<{ ok: true } | Fail> {
  const v = z.object({ c: Id, k: z.string().regex(/^intake:[a-z][a-z0-9_]{1,29}:[0-9a-f]{8}$/), m: z.record(z.string().max(120), z.string().max(40)) }).safeParse({ c: companyId, k: key, m: mapping });
  if (!v.success || JSON.stringify(v.data.m).length > 4000) return { ok: false, error: "The layout is not valid." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (await limited(supabase, "module", user.id)) return { ok: false, error: TOO_MANY };
  const { error } = await supabase.rpc("save_import_template", { p_company: companyId, p_export: key, p_mapping: v.data.m as unknown as Json });
  if (error) return { ok: false, error: dbError(error, "save_import_template") };
  return { ok: true };
}

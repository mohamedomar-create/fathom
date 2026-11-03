"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PL_KEYS } from "@/lib/engine";
import { getUser } from "@/lib/supabase/server";
import { dbError } from "@/lib/action-error";
import { SaveRowsSchema, SetupSchema, linesMatchRows } from "@/lib/company/budget-schema";
import { fyMonths } from "@/lib/engine/budget";
import { BUSY, checkLimit, TOO_MANY } from "@/lib/rate-limit";

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const Id = z.string().uuid();
const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Amount = z.number().finite().refine((v) => Math.abs(v) < 1e15);
const Line = z.object({ key: z.string().min(1).max(220), cls: z.enum(PL_KEYS), label: z.string().max(200).nullable(), month: Month, amount: Amount });
const Product = z.object({
  product: z.string().trim().min(1).max(200), category: z.string().max(200).nullable(), month: Month,
  units: z.number().finite().refine((v) => Math.abs(v) < 1e12), price: z.number().finite().refine((v) => Math.abs(v) < 1e12),
  unit_cost: z.number().finite().refine((v) => Math.abs(v) < 1e12).nullable(),
});
/** At most this many lines and product rows in one save (the database's own limit). */
const MAX = 20000;

async function begin() {
  const { supabase, user } = await getUser();
  if (!user) return { error: "Please sign in again." } as const;
  const lim = await checkLimit(supabase, "budget", user.id);
  if (lim === "over") return { error: TOO_MANY } as const;
  if (lim === "error") return { error: BUSY } as const;
  return { supabase } as const;
}

// The budget shows on Financials, KPIs and reports too.
const done = (companyId: string) => revalidatePath(`/company/${companyId}`, "layout");

export async function createBudget(companyId: string, input: { fy: string; kind: "original" | "revision"; name: string; from: string | null }): Promise<Result<string>> {
  const p = z.object({ fy: z.string().regex(/^\d{4}$/), kind: z.enum(["original", "revision"]), name: z.string().max(80), from: Id.nullable() }).safeParse(input);
  if (!Id.safeParse(companyId).success || !p.success) return { ok: false, error: "That value isn't valid." };
  const s = await begin();
  if ("error" in s) return { ok: false, error: s.error! };
  const { data, error } = await s.supabase.rpc("budget_create", { p_company: companyId, p_fy: p.data.fy, p_kind: p.data.kind, p_name: p.data.name, p_from: p.data.from });
  if (error) return { ok: false, error: dbError(error, "budget_create") };
  done(companyId);
  return { ok: true, data: data as string };
}

/**
 * One save, all or nothing: lines (added or changed; with replaceLines they replace all of the draft's lines) and
 * products (when given, they replace the draft's products). A part left null is left as it is.
 */
export async function saveBudget(companyId: string, versionId: string, input: { lines: unknown; products: unknown; replaceLines: boolean }): Promise<Result<undefined>> {
  const l = z.array(Line).max(MAX).nullable().safeParse(input.lines);
  const p = z.array(Product).max(MAX).nullable().safeParse(input.products);
  if (!Id.safeParse(companyId).success || !Id.safeParse(versionId).success) return { ok: false, error: "That value isn't valid." };
  if (!l.success) return { ok: false, error: "A budget line isn't valid." };
  if (!p.success) return { ok: false, error: "A product row isn't valid." };
  const s = await begin();
  if ("error" in s) return { ok: false, error: s.error! };
  const { error } = await s.supabase.rpc("budget_save", { p_version: versionId, p_lines: l.data, p_products: p.data, p_replace_lines: !!input.replaceLines });
  if (error) return { ok: false, error: dbError(error, "budget_save") };
  done(companyId);
  return { ok: true, data: undefined };
}

export async function approveBudget(companyId: string, versionId: string): Promise<Result> {
  if (!Id.safeParse(companyId).success || !Id.safeParse(versionId).success) return { ok: false, error: "That value isn't valid." };
  const s = await begin();
  if ("error" in s) return { ok: false, error: s.error! };
  const { error } = await s.supabase.rpc("budget_approve", { p_version: versionId });
  if (error) return { ok: false, error: dbError(error, "budget_approve") };
  done(companyId);
  return { ok: true, data: undefined };
}

export async function deleteBudget(companyId: string, versionId: string): Promise<Result> {
  if (!Id.safeParse(companyId).success || !Id.safeParse(versionId).success) return { ok: false, error: "That value isn't valid." };
  const s = await begin();
  if ("error" in s) return { ok: false, error: s.error! };
  const { error } = await s.supabase.rpc("budget_delete", { p_version: versionId });
  if (error) return { ok: false, error: dbError(error, "budget_delete") };
  done(companyId);
  return { ok: true, data: undefined };
}

export async function saveBudgetSetup(companyId: string, setup: unknown): Promise<Result> {
  const p = SetupSchema.safeParse(setup);
  if (!Id.safeParse(companyId).success || !p.success) return { ok: false, error: "That value isn't valid." };
  const s = await begin();
  if ("error" in s) return { ok: false, error: s.error! };
  const { error } = await s.supabase.rpc("budget_setup_save", { p_company: companyId, p_setup: p.data });
  if (error) return { ok: false, error: dbError(error, "budget_setup_save") };
  done(companyId);
  return { ok: true, data: undefined };
}

/** Saves the builder's rows (for the views given), optionally replacing the draft's lines and storing the setup, all or nothing. */
export async function saveBudgetRows(companyId: string, versionId: string, input: unknown): Promise<Result> {
  const p = SaveRowsSchema.safeParse(input);
  if (!Id.safeParse(companyId).success || !Id.safeParse(versionId).success) return { ok: false, error: "That value isn't valid." };
  if (!p.success) return { ok: false, error: "A budget row isn't valid." };
  const s = await begin();
  if ("error" in s) return { ok: false, error: s.error! };
  const { data: v, error: ve } = await s.supabase.from("budget_versions").select("company_id, fy").eq("id", versionId).maybeSingle();
  if (ve) return { ok: false, error: dbError(ve, "budget_rows_save") };
  if (!v || v.company_id !== companyId) return { ok: false, error: "That budget wasn't found." };
  if (p.data.lines) {
    const { data: c, error: ce } = await s.supabase.from("companies").select("fy_start_month").eq("id", companyId).maybeSingle();
    if (ce || !c) return { ok: false, error: ce ? dbError(ce, "budget_rows_save") : "That company wasn't found." };
    if (!linesMatchRows(p.data.rows, p.data.lines, fyMonths(v.fy, c.fy_start_month))) return { ok: false, error: "The budget lines don't add up to the revenue rows. Reload and try again." };
  }
  const { error } = await s.supabase.rpc("budget_rows_save", { p_version: versionId, p_rows: p.data.rows, p_views: p.data.views, p_lines: p.data.lines, p_setup: p.data.setup });
  if (error) return { ok: false, error: dbError(error, "budget_rows_save") };
  done(companyId);
  return { ok: true, data: undefined };
}

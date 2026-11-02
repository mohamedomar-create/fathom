"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PL_KEYS } from "@/lib/engine";
import { getUser } from "@/lib/supabase/server";
import { dbError } from "@/lib/action-error";
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
/** One save at most; the page sends bigger budgets in parts. */
const MAX = 5000;

async function begin() {
  const { supabase, user } = await getUser();
  if (!user) return { error: "Please sign in again." } as const;
  const lim = await checkLimit(supabase, "budget", user.id);
  if (lim === "over") return { error: TOO_MANY } as const;
  if (lim === "error") return { error: BUSY } as const;
  return { supabase } as const;
}

const done = (companyId: string) => revalidatePath(`/company/${companyId}/analysis/budget`);

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

export async function saveBudgetLines(companyId: string, versionId: string, lines: unknown, replace: boolean): Promise<Result<number>> {
  const p = z.array(Line).max(MAX).safeParse(lines);
  if (!Id.safeParse(companyId).success || !Id.safeParse(versionId).success || !p.success) return { ok: false, error: "A budget line isn't valid." };
  const s = await begin();
  if ("error" in s) return { ok: false, error: s.error! };
  const { data, error } = await s.supabase.rpc("budget_save_lines", { p_version: versionId, p_lines: p.data, p_replace: !!replace });
  if (error) return { ok: false, error: dbError(error, "budget_save_lines") };
  done(companyId);
  return { ok: true, data: data as number };
}

export async function saveBudgetProducts(companyId: string, versionId: string, rows: unknown, replace: boolean): Promise<Result<number>> {
  const p = z.array(Product).max(MAX).safeParse(rows);
  if (!Id.safeParse(companyId).success || !Id.safeParse(versionId).success || !p.success) return { ok: false, error: "A product row isn't valid." };
  const s = await begin();
  if ("error" in s) return { ok: false, error: s.error! };
  const { data, error } = await s.supabase.rpc("budget_save_products", { p_version: versionId, p_rows: p.data, p_replace: !!replace });
  if (error) return { ok: false, error: dbError(error, "budget_save_products") };
  done(companyId);
  return { ok: true, data: data as number };
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

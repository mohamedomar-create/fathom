"use server";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";

const Fingerprint = z.object({
  kind: z.string().min(1).max(120),
  sheet: z.string().max(300),
  headings: z.array(z.string().max(300)).max(300),
  read: z.array(z.string().max(300)).max(300),
  ignored: z.array(z.string().max(300)).max(300),
});

/** Remembers the layouts of an upload that was saved (one per export kind). Never fails the upload it follows. */
export async function saveLayouts(companyId: string, fps: z.input<typeof Fingerprint>[]): Promise<{ ok: boolean }> {
  const v = z.object({ companyId: z.string().uuid(), fps: z.array(Fingerprint).max(50) }).safeParse({ companyId, fps });
  if (!v.success || !v.data.fps.length) return { ok: false };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false };
  const byKind = new Map(v.data.fps.map((f) => [f.kind, f]));
  const { error } = await supabase.from("input_profiles").upsert([...byKind.values()].map((f) => ({ company_id: v.data.companyId, ...f })), { onConflict: "company_id,kind" });
  if (error) { if (error.code !== "PGRST205" && error.code !== "42P01") console.error("saveLayouts", error.message); return { ok: false }; }
  return { ok: true };
}

const FIELDS = ["date", "period", "doc", "customer", "product", "category", "salesperson", "qty", "untaxed", "total", "cost", "margin", "channel", "paid", "paidOn", "supplier", "account", "label", "fixedVar"] as const;
/**
 * Remembers what the person said each column of a Simple-mode sheet holds, by heading, so the next upload of the same
 * sheet is read the same way. Never fails the upload it follows.
 */
export async function saveColumnChoices(companyId: string, kind: "sales" | "expenses", named: Record<string, string>): Promise<{ ok: boolean }> {
  const v = z.object({ companyId: z.string().uuid(), kind: z.enum(["sales", "expenses"]), named: z.record(z.string().min(1).max(120), z.enum(FIELDS)).refine((m) => Object.keys(m).length <= 60) }).safeParse({ companyId, kind, named });
  if (!v.success || !Object.keys(v.data.named).length) return { ok: false };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false };
  const { error } = await supabase.rpc("save_import_template", { p_company: v.data.companyId, p_export: `simple:${v.data.kind}`, p_mapping: v.data.named });
  if (error) { console.error("saveColumnChoices", error.message); return { ok: false }; }
  return { ok: true };
}

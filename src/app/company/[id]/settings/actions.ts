"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ALL_CLASSES } from "@/lib/company/build";
import { saveCompanyData } from "@/lib/company/persist";
import { getUser } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

const ClassEnum = z.enum(ALL_CLASSES as [string, ...string[]]);
const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const ImportSchema = z.object({
  companyId: z.string().uuid(),
  filename: z.string().max(300).nullable(),
  accounts: z.array(z.object({
    code: z.string().max(40), name: z.string().min(1).max(300), cls: ClassEnum,
    amounts: z.record(Period, z.number().finite()),
    confidence: z.number().min(0).max(1).nullable().optional(),
    mapped_by: z.enum(["auto", "user", "system"]).optional(),
  })).min(1).max(5000),
  report: z.object({
    kind: z.string(), periods: z.array(Period), warnings: z.array(z.string()), notes: z.array(z.string()), flips: z.array(z.string()),
    mapping: z.record(z.string(), z.string()),
  }),
});

export async function commitImport(input: z.input<typeof ImportSchema>): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  const v = ImportSchema.safeParse(input);
  if (!v.success) return { ok: false, error: "The import data is not valid: " + v.error.issues[0]?.message };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  try {
    const version = await saveCompanyData(
      supabase, v.data.companyId,
      v.data.accounts.map((a) => ({ ...a, cls: a.cls as (typeof ALL_CLASSES)[number] })),
      { kind: "upload", filename: v.data.filename, report: v.data.report as unknown as Json },
      [...v.data.report.flips, ...v.data.report.notes],
    );
    await supabase.from("companies").update({ source: "upload" }).eq("id", v.data.companyId).neq("source", "odoo");
    revalidatePath(`/company/${v.data.companyId}`, "layout");
    return { ok: true, version };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

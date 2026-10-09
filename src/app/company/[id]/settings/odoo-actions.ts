"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { decrypt, encrypt } from "@/lib/crypto";
import { saveCompanyData } from "@/lib/company/persist";
import { OdooClient } from "@/lib/odoo/client";
import { assertPublicOdooUrl } from "@/lib/odoo/net";
import { probe, syncOdoo, type OdooProbe } from "@/lib/odoo/sync";
import { getUser } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : String(e) });

const ConnSchema = z.object({
  companyId: z.string().uuid(),
  url: z.string().min(8).max(300),
  db: z.string().trim().min(1).max(120),
  login: z.string().trim().min(1).max(200),
  apiKey: z.string().max(300).optional().default(""),
});

async function storedKey(companyId: string) {
  const { supabase } = await getUser();
  const { data } = await supabase.from("odoo_connections").select("api_key_enc").eq("company_id", companyId).maybeSingle();
  return data?.api_key_enc ? decrypt(data.api_key_enc) : "";
}

export async function testOdoo(input: z.input<typeof ConnSchema>): Promise<Result<OdooProbe>> {
  try {
    const v = ConnSchema.parse(input);
    const { user } = await getUser();
    if (!user) throw new Error("Please sign in again.");
    const url = await assertPublicOdooUrl(v.url);
    const key = v.apiKey || (await storedKey(v.companyId));
    if (!key) throw new Error("Enter the API key.");
    return { ok: true, data: await probe(new OdooClient(url, v.db, v.login, key)) };
  } catch (e) { return fail(e); }
}

const SaveSchema = ConnSchema.extend({
  odooCompanyId: z.number().int().positive(),
  odooCompanyName: z.string().max(200),
  includeBranches: z.boolean(),
  months: z.number().int().min(2).max(60),
  version: z.string().max(40).optional(),
});

export async function saveOdoo(input: z.input<typeof SaveSchema>): Promise<Result<true>> {
  try {
    const v = SaveSchema.parse(input);
    const { supabase, user } = await getUser();
    if (!user) throw new Error("Please sign in again.");
    const url = await assertPublicOdooUrl(v.url);
    const keyEnc = v.apiKey ? encrypt(v.apiKey) : (await supabase.from("odoo_connections").select("api_key_enc").eq("company_id", v.companyId).maybeSingle()).data?.api_key_enc;
    if (!keyEnc) throw new Error("Enter the API key.");
    const { error } = await supabase.from("odoo_connections").upsert({
      company_id: v.companyId, url, db: v.db, login: v.login, api_key_enc: keyEnc, odoo_company_id: v.odooCompanyId, odoo_company_name: v.odooCompanyName,
      include_branches: v.includeBranches, months_history: v.months, version: v.version ?? null, status: "saved", last_error: null,
    });
    if (error) throw new Error(error.message);
    revalidatePath(`/company/${v.companyId}/settings/source-data`);
    return { ok: true, data: true };
  } catch (e) { return fail(e); }
}

export async function syncOdooNow(companyId: string): Promise<Result<{ months: number; accounts: number; method: string; tb: number; unmapped: string[]; version: string }>> {
  const { supabase, user } = await getUser();
  try {
    if (!user) throw new Error("Please sign in again.");
    z.string().uuid().parse(companyId);
    const { data: conn } = await supabase.from("odoo_connections").select("*").eq("company_id", companyId).maybeSingle();
    if (!conn || !conn.odoo_company_id) throw new Error("Save the Odoo connection first.");
    const url = await assertPublicOdooUrl(conn.url);
    const client = new OdooClient(url, conn.db, conn.login, decrypt(conn.api_key_enc));
    const res = await syncOdoo(client, { companyId: conn.odoo_company_id, includeBranches: conn.include_branches, months: conn.months_history });
    if (res.periods.length < 1 || res.accounts.length < 2) throw new Error("Odoo returned no posted entries for that company and period.");
    await saveCompanyData(supabase, companyId, res.accounts, {
      kind: "odoo", filename: `${conn.odoo_company_name ?? "Odoo"} (${res.diagnostics.version})`,
      report: { kind: "odoo", periods: res.periods, warnings: res.diagnostics.unmapped.length ? [`${res.diagnostics.unmapped.length} unmapped account(s)`] : [], notes: res.notes, diagnostics: res.diagnostics } as unknown as Json,
    }, res.notes);
    await supabase.from("odoo_connections").update({ status: "ok", last_error: null, last_sync_at: new Date().toISOString(), version: res.diagnostics.version }).eq("company_id", companyId);
    await supabase.from("companies").update({ source: "odoo" }).eq("id", companyId);
    revalidatePath(`/company/${companyId}`, "layout");
    return { ok: true, data: { months: res.periods.length, accounts: res.accounts.length, method: res.diagnostics.method, tb: res.diagnostics.trialBalanceCheck, unmapped: res.diagnostics.unmapped, version: res.diagnostics.version } };
  } catch (e) {
    await supabase.from("odoo_connections").update({ status: "error", last_error: e instanceof Error ? e.message.slice(0, 500) : "error" }).eq("company_id", companyId);
    return fail(e);
  }
}

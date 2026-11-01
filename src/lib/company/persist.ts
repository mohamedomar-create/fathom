import { DbError } from "@/lib/action-error";
import "server-only";
import type { ClassKey } from "@/lib/engine";
import type { Json } from "@/lib/supabase/database.types";
import type { createClient } from "@/lib/supabase/server";
import { loadBalances } from "./balances";
import type { VersionAccount } from "./import-plan";
import { versionFrom, versionPayload } from "./version-payload";
export { versionFrom, versionPayload };

type Supa = Awaited<ReturnType<typeof createClient>>;

/** Versions kept for undo (the current one is always kept as well). */
export const KEEP_VERSIONS = 10;

export interface AccountInput {
  code: string;
  name: string;
  cls: ClassKey;
  /** Natural presentation sign (P&L: movement for the month; BS: closing balance). */
  amounts: Record<string, number>;
  odoo_id?: number | null;
  odoo_type?: string | null;
  confidence?: number | null;
  mapped_by?: "auto" | "user" | "system";
}

/** Load one stored data version with the import that supplied each monthly figure. */
export async function loadVersion(supabase: Supa, companyId: string, version: number): Promise<VersionAccount[]> {
  if (!version) return [];
  const { data: accts, error } = await supabase.from("source_accounts")
    .select("id, code, name, class, odoo_id, odoo_type, confidence, mapped_by, refs, sort_order")
    .eq("company_id", companyId).eq("version", version).order("sort_order");
  if (error) throw new DbError(error);
  return versionFrom(accts ?? [], await loadBalances(supabase, companyId, version));
}

/** Write a complete new data version (the merged snapshot) and prune versions beyond the undo history. */
export async function saveCompanyData(
  supabase: Supa, companyId: string, accounts: (AccountInput | VersionAccount)[],
  meta: { kind: "upload" | "odoo" | "demo"; filename?: string | null; report?: Json }, notes?: string[],
): Promise<{ version: number; importId: string }> {
  const payload = versionPayload(accounts);
  const { data, error } = await supabase.rpc("save_company_version", {
    p_company: companyId, p_accounts: payload as unknown as Json,
    p_import: { kind: meta.kind, filename: meta.filename ?? null, report: meta.report ?? {} } as Json,
    p_notes: (notes ?? null) as Json,
  });
  if (error) throw new DbError(error);
  const out = data as { version: number; import_id: string };
  // Keep the newest versions for undo; anything older is removed (the current version is always the newest here).
  const { error: e2 } = await supabase.from("source_accounts").delete().eq("company_id", companyId).lte("version", out.version - KEEP_VERSIONS);
  if (e2) console.error("pruning old data versions failed", e2.message);
  return { version: out.version, importId: out.import_id };
}

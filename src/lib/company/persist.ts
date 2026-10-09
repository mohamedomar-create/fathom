import "server-only";
import type { ClassKey } from "@/lib/engine";
import type { Json } from "@/lib/supabase/database.types";
import type { createClient } from "@/lib/supabase/server";
import { isPL, toNatural, toRaw } from "./build";
import type { SourceRef, VersionAccount } from "./import-plan";

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
  if (error) throw new Error(error.message);
  const byId = new Map((accts ?? []).map((a) => [a.id, {
    code: a.code, name: a.name, cls: a.class as ClassKey, amounts: {} as Record<string, number>, sources: {} as Record<string, string | null>,
    refs: (a.refs ?? {}) as Record<string, SourceRef>, odoo_id: a.odoo_id, odoo_type: a.odoo_type, confidence: a.confidence,
    mapped_by: a.mapped_by as VersionAccount["mapped_by"],
  } satisfies VersionAccount]));
  for (let from = 0; ; from += 1000) {
    const { data: bal, error: e2 } = await supabase.from("account_balances")
      .select("account_id, period, amount, import_id, source_accounts!inner(version)")
      .eq("company_id", companyId).eq("source_accounts.version", version)
      .order("account_id").order("period").range(from, from + 999);
    if (e2) throw new Error(e2.message);
    for (const b of bal ?? []) {
      const a = byId.get(b.account_id);
      if (!a) continue;
      a.amounts[b.period] = toNatural(a.cls, Number(b.amount));
      a.sources[b.period] = b.import_id;
    }
    if (!bal || bal.length < 1000) break;
  }
  return [...byId.values()];
}

/** Write a complete new data version (the merged snapshot) and prune versions beyond the undo history. */
export async function saveCompanyData(
  supabase: Supa, companyId: string, accounts: (AccountInput | VersionAccount)[],
  meta: { kind: "upload" | "odoo" | "demo"; filename?: string | null; report?: Json }, notes?: string[],
): Promise<{ version: number; importId: string }> {
  const payload = accounts.map((a) => {
    const v = a as VersionAccount;
    return {
      code: a.code, name: a.name, statement: isPL(a.cls) ? "PL" : "BS", class: a.cls,
      odoo_id: a.odoo_id ?? null, odoo_type: a.odoo_type ?? null, confidence: a.confidence ?? null, mapped_by: a.mapped_by ?? "auto",
      amounts: Object.fromEntries(Object.entries(a.amounts).filter(([, x]) => x).map(([p, x]) => [p, Math.round(toRaw(a.cls, x) * 100) / 100])),
      sources: v.sources ?? {},
      refs: v.refs ?? {},
    };
  });
  const { data, error } = await supabase.rpc("save_company_version", {
    p_company: companyId, p_accounts: payload as unknown as Json,
    p_import: { kind: meta.kind, filename: meta.filename ?? null, report: meta.report ?? {} } as Json,
    p_notes: (notes ?? null) as Json,
  });
  if (error) throw new Error(error.message);
  const out = data as { version: number; import_id: string };
  // Keep the newest versions for undo; anything older is removed (the current version is always the newest here).
  const { error: e2 } = await supabase.from("source_accounts").delete().eq("company_id", companyId).lte("version", out.version - KEEP_VERSIONS);
  if (e2) console.error("pruning old data versions failed", e2.message);
  return { version: out.version, importId: out.import_id };
}

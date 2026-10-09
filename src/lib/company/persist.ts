import "server-only";
import type { ClassKey } from "@/lib/engine";
import type { Json } from "@/lib/supabase/database.types";
import type { createClient } from "@/lib/supabase/server";
import { isPL, toRaw } from "./build";

type Supa = Awaited<ReturnType<typeof createClient>>;

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

/** Replace a company's chart of accounts + balances atomically, then remove the previous version. */
export async function saveCompanyData(
  supabase: Supa, companyId: string, accounts: AccountInput[],
  meta: { kind: "upload" | "odoo" | "demo"; filename?: string | null; report?: Json }, notes?: string[],
): Promise<number> {
  const payload = accounts.map((a) => ({
    code: a.code, name: a.name, statement: isPL(a.cls) ? "PL" : "BS", class: a.cls,
    odoo_id: a.odoo_id ?? null, odoo_type: a.odoo_type ?? null, confidence: a.confidence ?? null, mapped_by: a.mapped_by ?? "auto",
    amounts: Object.fromEntries(Object.entries(a.amounts).filter(([, v]) => v).map(([p, v]) => [p, Math.round(toRaw(a.cls, v) * 100) / 100])),
  }));
  const { data: version, error } = await supabase.rpc("replace_company_data", {
    p_company: companyId, p_accounts: payload as unknown as Json,
    p_import: { kind: meta.kind, filename: meta.filename ?? null, report: meta.report ?? {} } as Json,
    p_notes: (notes ?? null) as Json,
  });
  if (error) throw new Error(error.message);
  const { error: e2 } = await supabase.from("source_accounts").delete().eq("company_id", companyId).lt("version", version as number);
  if (e2) console.error("cleanup of previous data version failed", e2.message);
  return version as number;
}

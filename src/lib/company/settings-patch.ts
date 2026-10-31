import type { Json } from "@/lib/supabase/database.types";
import { dbError } from "@/lib/action-error";

type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }> };
/** Any Supabase client (its rpc is typed per function name; this helper calls one function). */
type Client = { rpc: unknown };

/**
 * Saves part of a company's settings (kpi_config) through update_company_settings (0044): only the patch is sent, and
 * the database merges it under a row lock (profile and inventory one level deep), so two saves at once both stick.
 * replaceKpis: the KPI page's save, which sends the whole KPI set.
 */
export async function patchSettings(client: Client, companyId: string, patch: Record<string, unknown>, opts: { replaceKpis?: boolean } = {}): Promise<{ ok: true; config: Record<string, unknown> } | { ok: false; error: string }> {
  const { data, error } = await (client as Rpc).rpc("update_company_settings", { p_company: companyId, p_patch: patch as Json, p_replace_kpis: opts.replaceKpis ?? false });
  if (error) return { ok: false, error: error.code === "42501" ? "You do not have permission to change this." : dbError(error, "updateCompanySettings") };
  return { ok: true, config: (data ?? {}) as Record<string, unknown> };
}

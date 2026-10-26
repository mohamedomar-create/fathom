import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Opus 5.5 prices in dollars per million tokens, which is millionths of a dollar per token. */
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

export interface Usage { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }

export const aiCostMicros = (u: Usage) => Math.round(
  u.input_tokens * PRICE.input + u.output_tokens * PRICE.output + (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead + (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite);

export const OVER_BUDGET = "This organisation's AI allowance for the month is used up. It renews on the 1st; an owner can raise it.";

/** True while the organisation is under its monthly AI allowance. A failed check is "no". */
export async function aiBudgetOk(supabase: SupabaseClient, orgId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("ai_budget_ok", { p_org: orgId });
  if (error) { console.error("ai budget check failed", { code: error.code, error: error.message }); return false; }
  return data === true;
}

/** Records what one AI call used (after the reply), so the allowance counts real spend. */
export async function recordAiUsage(supabase: SupabaseClient, orgId: string, kind: "commentary" | "read_page", usage: Usage | undefined | null) {
  if (!usage) return;
  const { error } = await supabase.rpc("record_ai_usage", { p_org: orgId, p_kind: kind, p_input: usage.input_tokens, p_output: usage.output_tokens, p_micros: aiCostMicros(usage) });
  if (error) console.error("ai usage not recorded", { code: error.code, error: error.message });
}

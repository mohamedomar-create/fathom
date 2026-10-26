import "server-only";
import { getUser } from "@/lib/supabase/server";
import { loadCompanyMeta } from "./meta";
import { keepGood, goodOf } from "./summary-cache";
import { loaded, type Loaded } from "./loaded";
import { fromStateRow, afterError, type StateRow } from "./summary-state";
import { logOp, newRef, withRetry } from "@/lib/observe";

type Kind = "sales" | "expenses" | "payments";
const LEGACY: Record<Kind, "sales_summary" | "expense_summary" | "payments_summary"> = { sales: "sales_summary", expenses: "expense_summary", payments: "payments_summary" };

/**
 * A module's figures with an explicit state. Reads the summary the database keeps ready (summary_state, 0032); before that
 * update, the summary function itself. A failed read is "failed" (or "stale" with the last good copy), never empty figures.
 * The person's membership is checked first (loadCompanyMeta: not a member → not found).
 */
export async function loadKept<T>(kind: Kind, companyId: string, parse: (raw: unknown) => T, empty: T, isEmpty: (d: T) => boolean): Promise<Loaded<T>> {
  await loadCompanyMeta(companyId);
  const { supabase } = await getUser();
  const held = goodOf<T>(kind, companyId);
  const ref = newRef();
  const t0 = Date.now();
  const { result, attempts } = await withRetry(() => supabase.rpc("summary_state", { p_company: companyId, p_kind: kind, p_have: held?.seq ?? null }));
  if (!result.error) {
    const { state, keep } = fromStateRow<T>(result.data as StateRow, held, parse, empty, isEmpty, ref);
    if (keep) keepGood(kind, companyId, keep.seq, keep.builtAt, keep.data);
    logOp({ op: `summary_state:${kind}`, company: companyId, ms: Date.now() - t0, attempts, outcome: state.status === "ready" ? "ok" : state.status, code: state.code, ref: state.ref });
    if (state.status !== "pending") return state;
    // Just after a change, before the worker has rebuilt it: add it up live once (as before 0032), so the page shows the
    // latest figures straight away. If that is too slow or fails, the previous figures (marked as updating) or the
    // waiting screen stand.
    const live = await liveSummary(kind, companyId, parse, ref);
    return live ? loaded(isEmpty(live) ? "empty" : "ready", live) : state;
  }
  logOp({ op: `summary_state:${kind}`, company: companyId, ms: Date.now() - t0, attempts, outcome: held ? "stale" : "failed", code: result.error.code, ref });
  return afterError(held, empty, ref, result.error.code);
}

/** The summary function itself, once, with no retry (a pending rebuild is seconds away); null when it fails. */
async function liveSummary<T>(kind: Kind, companyId: string, parse: (raw: unknown) => T, ref: string): Promise<T | null> {
  const { supabase } = await getUser();
  const t0 = Date.now();
  const r = await supabase.rpc(LEGACY[kind], { p_company: companyId });
  logOp({ op: `${LEGACY[kind]}:while-pending`, company: companyId, ms: Date.now() - t0, attempts: 1, outcome: r.error ? "failed" : "fallback", code: r.error?.code, ref: r.error ? ref : undefined });
  return r.error ? null : parse(r.data);
}

import "server-only";
import { getUser } from "@/lib/supabase/server";
import { loadCompanyMeta, summaryStamps } from "./meta";
import { remember, keepGood, goodOf } from "./summary-cache";
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
    return state;
  }
  if (result.error.code !== "PGRST202") {
    logOp({ op: `summary_state:${kind}`, company: companyId, ms: Date.now() - t0, attempts, outcome: held ? "stale" : "failed", code: result.error.code, ref });
    return afterError(held, empty, ref, result.error.code);
  }
  // Before migration 0032: the summary function, kept between visits while nothing it is built from changed.
  const stamp = (await summaryStamps(companyId))[kind];
  const t1 = Date.now();
  let tries = 0;
  try {
    const raw = await remember(kind, companyId, stamp, async () => {
      const { result: r, attempts: a } = await withRetry(() => supabase.rpc(LEGACY[kind], { p_company: companyId }));
      tries = a;
      if (r.error) throw r.error;
      return r.data;
    });
    const data = parse(raw);
    keepGood(kind, companyId, null, new Date().toISOString(), data);
    logOp({ op: `${LEGACY[kind]}`, company: companyId, ms: Date.now() - t1, attempts: tries, outcome: "fallback" });
    return loaded(isEmpty(data) ? "empty" : "ready", data);
  } catch (e) {
    const code = (e as { code?: string }).code;
    logOp({ op: `${LEGACY[kind]}`, company: companyId, ms: Date.now() - t1, attempts: tries, outcome: held ? "stale" : "failed", code, ref });
    return afterError(held, empty, ref, code);
  }
}

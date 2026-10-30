import "server-only";
import type { getUser } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import { dbError } from "@/lib/action-error";
import { addMonths } from "@/lib/engine";
import { openPeriods } from "./close";
import { closedThroughOf } from "./close-server";

type Db = Awaited<ReturnType<typeof getUser>>["supabase"];
export type StageKind = "sales" | "expenses" | "payments";

/**
 * Staged line saves (migration 0035): chunks are held apart until the finish, which replaces the save's months and adds
 * every line in one step, so no page ever shows half a month and a save that stops changes nothing. `missing` means the
 * database has no stage functions yet (its update not applied); the caller then uses the older direct path.
 */
export async function stageBegin(supabase: Db, kind: StageKind, p: { companyId: string; source: "ledger" | "file"; periods: string[]; filename?: string; report?: Record<string, unknown>; all?: boolean }): Promise<{ ok: true; stage: string; closed: string[] } | { ok: false; error: string; missing?: true }> {
  const r = await closedRange(supabase, p.companyId, p.periods, !!p.all);
  if (!r.periods.length && !r.all) return { ok: false, error: allClosed(r.closed) };
  const { data, error } = await supabase.rpc("stage_lines_begin", {
    p_company: p.companyId, p_kind: kind, p_source: p.source, p_periods: r.periods, p_filename: p.filename?.slice(0, 300),
    p_report: (p.report ?? {}) as Json, p_all: r.all,
  });
  if (error) return error.code === "PGRST202" ? { ok: false, error: "missing", missing: true } : { ok: false, error: dbError(error, "stage_lines_begin") };
  return { ok: true, stage: data as string, closed: r.closed };
}

export const allClosed = (closed: string[]) => `Every month in this upload is closed (${closed.join(", ")}): nothing was saved. Reopen a month in Settings, Month close, to change it.`;

/**
 * The months a save may replace, leaving out closed ones (0043): their lines are never sent again, and the stage's finish
 * keeps only lines in the months it replaces. "Replace all" in a company with closed months replaces every open month
 * up to a year past the file's last month (the database refuses a change to a closed month whatever the path).
 */
export async function closedRange(supabase: Db, companyId: string, periods: string[], all: boolean): Promise<{ periods: string[]; all: boolean; closed: string[] }> {
  const ps = [...new Set(periods)].sort();
  const closedThrough = await closedThroughOf(supabase, companyId);
  if (!closedThrough) return { periods: ps, all, closed: [] };
  const open = openPeriods(ps, closedThrough);
  const closed = ps.filter((x) => !open.includes(x));
  if (!all) return { periods: open, all: false, closed };
  const last = [ps[ps.length - 1] ?? closedThrough, addMonths(new Date().toISOString().slice(0, 7), 12)].sort().pop()!;
  const range: string[] = [];
  for (let m = addMonths(closedThrough, 1); m <= last && range.length < 600; m = addMonths(m, 1)) range.push(m);
  return { periods: range, all: false, closed };
}

export async function stageAdd(supabase: Db, stage: string, lines: unknown[]): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("stage_lines_add", { p_stage: stage, p_lines: lines as Json });
  if (error) return { ok: false, error: dbError(error, "stage_lines_add") };
  return { ok: true, saved: data as number };
}

/** `sent` lines were held; `saved` went in. A difference means lines the database refused (outside the save's months). */
export async function stageFinish(supabase: Db, stage: string): Promise<{ ok: true; batch: string | null; saved: number; sent: number } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("stage_lines_finish", { p_stage: stage });
  if (error) return { ok: false, error: dbError(error, "stage_lines_finish") };
  const r = (data ?? {}) as { batch?: string | null; saved?: number; sent?: number };
  return { ok: true, batch: r.batch ?? null, saved: Number(r.saved ?? 0), sent: Number(r.sent ?? 0) };
}

export async function stageCancel(supabase: Db, stage: string): Promise<void> {
  await supabase.rpc("stage_lines_cancel", { p_stage: stage });
}

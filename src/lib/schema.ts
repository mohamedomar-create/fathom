import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** The database version this app needs (public.schema_version(), raised by each migration). */
export const REQUIRED_SCHEMA = 41;

type Health = { status: 200 | 503; body: { ok: boolean; db: boolean; schema: number | null; required: number; problem?: string; commit?: string; time: string } };

export function healthAnswer(s: { db: boolean; schema: number | null }): Health {
  const problem = !s.db ? "database unreachable" : (s.schema ?? 0) < REQUIRED_SCHEMA ? `database needs update ${REQUIRED_SCHEMA}` : undefined;
  return {
    status: problem ? 503 : 200,
    body: { ok: !problem, db: s.db, schema: s.schema, required: REQUIRED_SCHEMA, ...(problem ? { problem } : {}), commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7), time: new Date().toISOString() },
  };
}

let cached: { at: number; schema: number | null } | null = null;

/** The database's version, read at most once a minute per server instance; null when it cannot be read. */
export async function databaseSchema(supabase: SupabaseClient): Promise<{ db: boolean; schema: number | null }> {
  if (cached && Date.now() - cached.at < 60_000 && cached.schema !== null) return { db: true, schema: cached.schema };
  const { data, error } = await supabase.rpc("schema_version");
  if (error) {
    // No such function: a database from before 0040 (reachable, but behind).
    const behind = error.code === "PGRST202" || error.code === "42883";
    return { db: behind, schema: behind ? 0 : null };
  }
  cached = { at: Date.now(), schema: Number(data) };
  return { db: true, schema: cached.schema };
}

/** For tests: forget the version read earlier. */
export const resetSchemaCache = () => { cached = null; };

/**
 * The update the database needs before the pages can work (the database is older than this app), or null. A database
 * that could not be asked just now is not "behind": the pages show their own error, never this screen.
 */
export async function schemaBehind(supabase: SupabaseClient): Promise<number | null> {
  const s = await databaseSchema(supabase);
  return s.db && s.schema !== null && s.schema < REQUIRED_SCHEMA ? REQUIRED_SCHEMA : null;
}

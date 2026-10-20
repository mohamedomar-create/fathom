import "server-only";
import { randomBytes } from "node:crypto";
import { createHash } from "node:crypto";

// One JSON line per database operation a page or action depends on, so a page that answered 200 but could not read its
// figures is visible in the logs: what ran, for which company (a short hash, never the name), how long, how many
// attempts, the SQL code and the outcome, with the reference shown to the person. Never figures, names or keys.

export const newRef = () => randomBytes(3).toString("hex").toUpperCase();
export const companyTag = (id: string) => createHash("sha256").update(id).digest("hex").slice(0, 8);

export interface OpLog { op: string; company?: string; ms: number; attempts: number; outcome: "ok" | "empty" | "pending" | "stale" | "failed" | "fallback"; code?: string; ref?: string }

export function logOp(e: OpLog) {
  const line = JSON.stringify({ level: e.outcome === "failed" || e.outcome === "stale" ? "error" : "info", kind: "op", ...e, company: e.company ? companyTag(e.company) : undefined });
  if (e.outcome === "failed" || e.outcome === "stale") console.error(line); else console.log(line);
}

/** Errors worth one more try: a statement time-out, a lock wait, an unavailable or overloaded gateway, a dropped connection. */
export function transient(e: { code?: string; message?: string; status?: number } | null | undefined): boolean {
  if (!e) return false;
  if (e.code && ["57014", "55P03", "53300", "08006", "08001", "PGRST000", "PGRST001", "PGRST003"].includes(e.code)) return true;
  if (e.status && [502, 503, 504].includes(e.status)) return true;
  return /fetch failed|network|ECONNRESET|ETIMEDOUT|socket hang up/i.test(e.message ?? "");
}

/**
 * Runs a read with at most one retry on a transient error (after a short, jittered pause), so a busy moment does not
 * fail a page, and a lasting failure does not become a storm of retries.
 */
export async function withRetry<T extends { error: { code?: string; message?: string } | null }>(run: () => PromiseLike<T>, wait = 300): Promise<{ result: T; attempts: number }> {
  const first = await run();
  if (!transient(first.error)) return { result: first, attempts: 1 };
  await new Promise((r) => setTimeout(r, wait + Math.floor(Math.random() * wait)));
  return { result: await run(), attempts: 2 };
}

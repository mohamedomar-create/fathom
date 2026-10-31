// Summaries that take the database a second to add up (sales, expenses, payments) are kept per company in this server
// process and handed back while their stamp is the same: the stamp names every upload and setting they are built from,
// so a new upload, a cleared module or a changed account class adds them up again. Kept 10 minutes at most, 60 at most.
// Only called after the person's membership of the company was checked (loadCompanyMeta).
const TTL_MS = 10 * 60_000;
const MAX = 60;
const kept = new Map<string, { stamp: string; at: number; value: Promise<unknown> }>();

export async function remember<T>(kind: string, companyId: string, stamp: string, load: () => Promise<T>): Promise<T> {
  const key = `${kind}:${companyId}`;
  const hit = kept.get(key);
  if (hit && hit.stamp === stamp && Date.now() - hit.at < TTL_MS) return hit.value as Promise<T>;
  const value = load();
  kept.delete(key);
  kept.set(key, { stamp, at: Date.now(), value });
  while (kept.size > MAX) kept.delete(kept.keys().next().value!);
  // A failed load is never kept: the next visit tries again.
  value.catch(() => { if (kept.get(key)?.value === value) kept.delete(key); });
  return value;
}

/** Forget everything kept (tests), or one company's summaries. */
export function forget(companyId?: string) {
  if (!companyId) { kept.clear(); return; }
  for (const k of [...kept.keys()]) if (k.endsWith(`:${companyId}`)) kept.delete(k);
}

// The last summary read without error, per company and kind, with the build it came from: sent as "already held" so the
// database leaves an unchanged summary out, and shown (marked as not the latest, with its time) when a read fails.
const good = new Map<string, { seq: number | null; builtAt: string | null; data: unknown; at: number }>();
const GOOD_MAX = 60;
/** A copy older than this is no longer served as good (O16): a failed read then says so rather than show old figures. */
const GOOD_TTL_MS = 30 * 60_000;

export function keepGood<T>(kind: string, companyId: string, seq: number | null, builtAt: string | null, data: T) {
  const key = `${kind}:${companyId}`;
  good.delete(key);
  good.set(key, { seq, builtAt, data, at: Date.now() });
  while (good.size > GOOD_MAX) good.delete(good.keys().next().value!);
}

export function goodOf<T>(kind: string, companyId: string): { seq: number | null; builtAt: string | null; data: T } | null {
  const key = `${kind}:${companyId}`;
  const hit = good.get(key) as { seq: number | null; builtAt: string | null; data: T; at: number } | undefined;
  if (!hit) return null;
  if (Date.now() - hit.at > GOOD_TTL_MS) { good.delete(key); return null; }
  return hit;
}

/** Forget the last good copies too (tests, or one company). */
export function forgetGood(companyId?: string) {
  if (!companyId) { good.clear(); return; }
  for (const k of [...good.keys()]) if (k.endsWith(`:${companyId}`)) good.delete(k);
}

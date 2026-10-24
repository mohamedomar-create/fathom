/**
 * A rate limit kept in this server's memory, for signed-out callers identified only by their address. Counting those in
 * the database would let anyone count against anyone's address (migration 0038 took that from signed-out callers), so
 * the address limit is per server instance; a published link's allowance is still counted in the database.
 * Returns a function that records a hit and says whether the key is over the limit.
 */
export function localLimiter(windowMs: number, max: number, maxKeys = 10_000) {
  const hits = new Map<string, number[]>();
  const over = (key: string, now = Date.now()) => {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) { hits.set(key, recent); return true; }
    recent.push(now);
    hits.delete(key);
    hits.set(key, recent);
    // Oldest keys go first (a Map keeps insertion order, and a key is re-inserted on every hit).
    while (hits.size > maxKeys) hits.delete(hits.keys().next().value as string);
    return false;
  };
  over.size = () => hits.size;
  return over;
}

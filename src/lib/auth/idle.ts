/** Signed out after this long without activity, warned this long before. */
export const IDLE_MS = 30 * 60_000;
export const WARN_MS = 2 * 60_000;
/** The server's last-seen cookie (milliseconds since 1970), refreshed on each signed-in request. */
export const SEEN_COOKIE = "ir_seen";

export type IdleState = "active" | "warn" | "out";

export function idleState(last: number, now: number, limit = IDLE_MS, warn = WARN_MS): IdleState {
  const gap = now - last;
  return gap >= limit ? "out" : gap >= limit - warn ? "warn" : "active";
}

/** A tab closed for longer than the limit: the next request finds the stamp stale. No stamp yet is not stale. */
export function seenIsStale(stamp: string | undefined, now: number, limit = IDLE_MS) {
  const t = Number(stamp);
  return !!stamp && Number.isFinite(t) && t > 0 && now - t > limit;
}

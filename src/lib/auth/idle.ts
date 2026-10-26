/** Signed out after this long without activity, warned this long before. */
export const IDLE_MS = 30 * 60_000;
export const WARN_MS = 2 * 60_000;
/** The server's last-seen cookie (milliseconds since 1970), refreshed on each signed-in request. */
export const SEEN_COOKIE = "ir_seen";
/** Kept when the browser closes, so a session reopened next morning finds its stamp stale. */
export const SEEN_MAX_AGE_S = 30 * 24 * 3600;
/** An active page with no requests (a long form) tells the server this often that the person is still there. */
export const HEARTBEAT_MS = 5 * 60_000;

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

/** What the proxy does with the stamp: end a stale session, refresh a live one, or clear one left by a session gone. */
export function seenAction(signedIn: boolean, stamp: string | undefined, now: number): "signout" | "refresh" | "clear" | "none" {
  if (signedIn) return seenIsStale(stamp, now) ? "signout" : "refresh";
  return stamp ? "clear" : "none";
}

export const heartbeatDue = (lastBeat: number, now: number, every = HEARTBEAT_MS) => now - lastBeat >= every;

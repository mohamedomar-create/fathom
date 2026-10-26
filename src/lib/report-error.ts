import "server-only";
import { randomUUID } from "node:crypto";

/** Removes anything that could identify a company or person: emails, long numbers (amounts, ids), cookies, bodies, queries. */
const scrub = (t: string) => t
  .replace(/[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/gi, "[email]")
  .replace(/\d[\d,.]*\d|\d/g, (m) => (m.replace(/\D/g, "").length > 4 ? "[number]" : m));

type Event = { message?: string; request?: { url?: string; cookies?: unknown; data?: unknown; headers?: Record<string, string> }; user?: { id?: string; email?: string }; [k: string]: unknown };

/** What an error report may carry: the message (scrubbed), the address without its query, the browser, the user's id. */
export function scrubEvent<T extends Event>(e: T): T {
  const out: Event = { ...e };
  if (typeof e.message === "string") out.message = scrub(e.message);
  if (e.request) {
    const url = e.request.url ? e.request.url.split("?")[0] : undefined;
    const ua = e.request.headers?.["user-agent"];
    out.request = { ...(url ? { url } : {}), ...(ua ? { headers: { "user-agent": ua } } : {}) };
  }
  if (e.user) out.user = e.user.id ? { id: e.user.id } : {};
  return out as T;
}

/**
 * Sends a server error to Sentry when SENTRY_DSN is set (nothing otherwise), tagged with the reference the person sees,
 * so a screenshot and the report can be matched. Never throws.
 */
export async function reportError(err: unknown, ctx: { route?: string; ref?: string; path?: string } = {}) {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    const u = new URL(dsn);
    const project = u.pathname.replace(/^\//, "");
    const e = err instanceof Error ? err : new Error(String(err));
    const event = scrubEvent({
      event_id: randomUUID().replace(/-/g, ""), timestamp: Date.now() / 1000, platform: "node", level: "error",
      environment: process.env.VERCEL_ENV ?? "development", release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12),
      message: `${e.name}: ${e.message}`,
      exception: { values: [{ type: e.name, value: scrub(e.message), stacktrace: { frames: (e.stack ?? "").split("\n").slice(1, 8).map((l) => ({ function: l.trim().slice(0, 200) })).reverse() } }] },
      tags: { route: ctx.route ?? "", ref: ctx.ref ?? "" },
      request: ctx.path ? { url: ctx.path } : undefined,
    });
    const body = `${JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() })}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(event)}\n`;
    await fetch(`${u.protocol}//${u.host}/api/${project}/envelope/`, {
      method: "POST", body, signal: AbortSignal.timeout(2000),
      headers: { "content-type": "application/x-sentry-envelope", "x-sentry-auth": `Sentry sentry_version=7, sentry_client=ireport/1, sentry_key=${u.username}` },
    });
  } catch { /* reporting must never break the page */ }
}

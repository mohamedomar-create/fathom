"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useDict } from "@/lib/i18n/context";
import { createClient } from "@/lib/supabase/client";
import { idleState, IDLE_MS, WARN_MS, type IdleState } from "@/lib/auth/idle";

/** Last activity in any tab of this browser (milliseconds), so a busy tab keeps the quiet ones signed in. */
const ACTIVE_KEY = "ir_active";
const readActive = () => { try { return Number(localStorage.getItem(ACTIVE_KEY)) || 0; } catch { return 0; } };
const writeActive = (t: number) => { try { localStorage.setItem(ACTIVE_KEY, String(t)); } catch { /* private window: this tab only */ } };
/** Browser tests shorten the limit through window.__irIdleMs. */
const limits = () => { const w = (globalThis as { __irIdleMs?: number }).__irIdleMs; return w ? { limit: w, warn: Math.min(WARN_MS, w / 2) } : { limit: IDLE_MS, warn: WARN_MS }; };

/**
 * Tells a signed-in person, in plain words, when their session has ended: on returning to the tab, every half minute,
 * and whenever they press something (so a Save that can no longer go through is explained at once, with a way back to
 * this page). Pages for signed-out visitors never show it: it only watches a session it has seen.
 */
/** Supabase keeps the session in "sb-<project>-auth-token" (split into .0, .1 … when long). */
export const hasSessionCookie = (cookie: string) => /(?:^|;\s*)sb-[^=]+-auth-token(?:\.\d+)?=[^;]+/.test(cookie);

export function SessionWatch() {
  const d = useDict().state;
  const path = usePathname();
  const query = useSearchParams().toString();
  const [ended, setEnded] = useState(false);
  const [idle, setIdle] = useState<IdleState>("active");
  const seen = useRef(false);
  const local = useRef(0);
  const pathRef = useRef("");
  useEffect(() => { pathRef.current = path + (query ? `?${query}` : ""); }, [path, query]);
  // Signed out after 30 minutes with no activity in any tab, warned 2 minutes before.
  useEffect(() => {
    const touch = () => { const now = Date.now(); if (now - local.current > 5_000) { local.current = now; writeActive(now); } };
    local.current = 0;
    touch();
    const tick = () => {
      if (!seen.current) return;
      const { limit, warn } = limits();
      const s = idleState(Math.max(local.current, readActive()), Date.now(), limit, warn);
      setIdle(s);
      if (s === "out") {
        seen.current = false;
        void createClient().auth.signOut({ scope: "local" }).finally(() => {
          // A full page load, so nothing read while signed in stays in the page's memory.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.assign(`/login?reason=idle&next=${encodeURIComponent(pathRef.current)}`);
        });
      }
    };
    const timer = setInterval(tick, 5_000);
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, touch, { passive: true, capture: true });
    return () => { clearInterval(timer); for (const e of events) window.removeEventListener(e, touch, true); };
  }, []);
  useEffect(() => {
    // The session lives in the auth cookie (the server refreshes or clears it); the browser client's memory can outlive
    // it. Reading the cookie is cheap, so every press is checked.
    const check = () => {
      if (hasSessionCookie(document.cookie)) { seen.current = true; setEnded(false); } else if (seen.current) setEnded(true);
    };
    check();
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    const timer = setInterval(check, 30_000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pointerdown", check, true);
    return () => { clearInterval(timer); window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("pointerdown", check, true); };
  }, []);
  if (idle === "warn" && !ended) return (
    <div role="alert" data-testid="idle-warning" className="fixed inset-x-0 bottom-4 z-50 mx-auto flex max-w-xl flex-wrap items-center gap-3 rounded-lg border border-amber bg-white p-4 text-[15px] shadow-lg">
      <span className="min-w-0 flex-1">{d.idleWarn}</span>
      <button type="button" data-testid="stay-signed-in" onClick={() => { local.current = Date.now(); writeActive(local.current); setIdle("active"); }}
        className="rounded bg-brand-d px-4 py-2 text-sm text-white">{d.staySignedIn}</button>
    </div>
  );
  if (!ended) return null;
  const next = encodeURIComponent(path + (query ? `?${query}` : ""));
  return (
    <div role="alert" data-testid="session-ended" className="fixed inset-x-0 bottom-4 z-50 mx-auto flex max-w-xl flex-wrap items-center gap-3 rounded-lg border border-amber bg-white p-4 text-[15px] shadow-lg">
      <span className="min-w-0 flex-1">{d.sessionEnded}</span>
      <a href={`/login?next=${next}`} className="rounded bg-brand-d px-4 py-2 text-sm text-white">{d.signInAgain}</a>
    </div>
  );
}

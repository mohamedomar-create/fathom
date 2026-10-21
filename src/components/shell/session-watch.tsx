"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useDict } from "@/lib/i18n/context";

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
  const seen = useRef(false);
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
  if (!ended) return null;
  const next = encodeURIComponent(path + (query ? `?${query}` : ""));
  return (
    <div role="alert" data-testid="session-ended" className="fixed inset-x-0 bottom-4 z-50 mx-auto flex max-w-xl flex-wrap items-center gap-3 rounded-lg border border-amber bg-white p-4 text-[15px] shadow-lg">
      <span className="min-w-0 flex-1">{d.sessionEnded}</span>
      <a href={`/login?next=${next}`} className="rounded bg-brand-d px-4 py-2 text-sm text-white">{d.signInAgain}</a>
    </div>
  );
}

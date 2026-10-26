import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/env";
import { isUuid } from "@/lib/ids";
import { SEEN_COOKIE, SEEN_MAX_AGE_S, seenAction } from "@/lib/auth/idle";
import { codeStillNeeded } from "@/lib/auth/levels";

const PROTECTED = ["/companies", "/company", "/cash", "/dashboard", "/admin", "/account"];

/** Refreshes the Supabase session cookie on every request and guards app routes. */
export async function proxy(request: NextRequest) {
  // A company or report address that can't be an id is "not found" at once: no query, and a true 404 (inside the
  // company section the page streams, so a later "not found" could only answer 200).
  if (malformedId(request.nextUrl.pathname)) return NextResponse.rewrite(new URL("/not-found-id", request.url), { status: 404 });
  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  let { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  // Nothing from this browser for 30 minutes (every tab closed): the session ends here; open tabs sign out themselves.
  const seen = seenAction(!!data.user, request.cookies.get(SEEN_COOKIE)?.value, Date.now());
  let idle = false;
  if (seen === "signout") {
    await supabase.auth.signOut({ scope: "local" });
    data = { user: null };
    idle = true;
  }
  const guarded = !keepsOwnAnswer(request) && PROTECTED.some((p) => path === p || path.startsWith(p + "/"));
  // Two-step sign-in is on but this session entered only the password: the code comes first (the database shows such a
  // session nothing anyway).
  if (data.user && guarded) {
    const { data: levels } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (codeStillNeeded(levels)) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "";
      url.searchParams.set("mfa", "1");
      url.searchParams.set("next", path + request.nextUrl.search);
      const redirect = NextResponse.redirect(url);
      for (const c of response.cookies.getAll()) redirect.cookies.set(c);
      return redirect;
    }
  }
  if (!data.user && guarded) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", path + request.nextUrl.search);
    if (idle) url.searchParams.set("reason", "idle");
    const redirect = NextResponse.redirect(url);
    for (const c of response.cookies.getAll()) redirect.cookies.set(c); // keep refreshed/cleared auth cookies
    redirect.cookies.delete(SEEN_COOKIE);
    return redirect;
  }
  if (data.user) response.cookies.set(SEEN_COOKIE, String(Date.now()), { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/", maxAge: SEEN_MAX_AGE_S });
  // Signed out: a stamp left by the last session would end the next sign-in at once.
  else if (idle || seen === "clear") response.cookies.delete(SEEN_COOKIE);
  return response;
}

/** /company/<id>/… and /company/<id>/reports/<rid> whose ids are not ids. */
export function malformedId(path: string): boolean {
  const seg = path.split("/");
  if (seg[1] === "cash" && seg.length >= 3) return !isUuid(seg[2]);
  if (seg[1] !== "company" || seg.length < 3) return false;
  if (!isUuid(seg[2])) return true;
  return seg[3] === "reports" && seg.length > 4 && seg[4] !== "" && !isUuid(seg[4]);
}

/**
 * A form's Save (a server action) and the API answer for themselves when the session has ended ("Please sign in
 * again."), so they are never redirected: a redirect would hand the form a sign-in page it can't read.
 */
export function keepsOwnAnswer(request: Pick<NextRequest, "method" | "headers" | "nextUrl">): boolean {
  return request.nextUrl.pathname.startsWith("/api/") || (request.method === "POST" && request.headers.has("next-action"));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|demo|r/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/env";
import { isUuid } from "@/lib/ids";

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
  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  if (!data.user && !keepsOwnAnswer(request) && PROTECTED.some((p) => path === p || path.startsWith(p + "/"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path + request.nextUrl.search);
    const redirect = NextResponse.redirect(url);
    for (const c of response.cookies.getAll()) redirect.cookies.set(c); // keep refreshed/cleared auth cookies
    return redirect;
  }
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

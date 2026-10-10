/**
 * A same-site path to go to after sign-in, or the fallback. Refuses anything a browser or URL parser could read as
 * another site: "//evil.com", "/\evil.com" (backslash is a slash in URLs), encoded slashes, schemes and control characters.
 */
export function safeNext(raw: string | null | undefined, fallback = "/companies"): string {
  if (!raw || raw.length > 500) return fallback;
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { return fallback; }
  for (const s of [raw, decoded]) {
    if (!s.startsWith("/") || s.startsWith("//") || /[\\\s\u0000-\u001f\u007f]/.test(s)) return fallback;
  }
  // Final proof: resolved against our origin, it must stay on our origin.
  try {
    const u = new URL(raw, "https://app.invalid");
    if (u.origin !== "https://app.invalid") return fallback;
  } catch { return fallback; }
  return raw;
}

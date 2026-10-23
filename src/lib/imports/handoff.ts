export type HandOff = { by: "server" } | { by: "page" } | { refused: string };

/**
 * What the page does after asking the server to read the stored files (`status` null: no answer). The page sends the
 * rows itself only when the server failed or could not be reached, or could not read the file; a refusal (preflight,
 * signed out, not allowed, import closed) stops the page as well, so it never goes around the server's checks.
 */
export function handOffOutcome(status: number | null, body: { error?: unknown } | null): HandOff {
  if (status === 202) return { by: "server" };
  if (status === null || status >= 500) return { by: "page" };
  const why = typeof body?.error === "string" ? body.error : "";
  if (status === 422 && !/^PREFLIGHT/.test(why)) return { by: "page" };
  return { refused: why || `The server refused this import (${status}).` };
}

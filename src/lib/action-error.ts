import { randomBytes } from "node:crypto";
import { ZodError } from "zod";

/** A database error carried as an exception: its text is logged, never shown. */
export class DbError extends Error {
  constructor(readonly db: { code?: string; message: string; details?: string | null; hint?: string | null }) { super(db.message); }
}

const ref = () => randomBytes(3).toString("hex").toUpperCase();

/**
 * What a user may see about a database error. Permission and validation failures get a plain sentence; anything else
 * is logged with a short reference that support can search for, so table names and SQL never reach the browser.
 */
export function dbError(error: { code?: string; message: string; details?: string | null; hint?: string | null }, context: string): string {
  switch (error.code) {
    case "42501": return "You don't have permission to do that.";
    case "PGRST116": return "Not found.";
    case "23505": return "That already exists.";
    case "23503": return "That refers to something that no longer exists. Refresh the page and try again.";
    case "22P02": case "22001": case "23502": case "23514": case "22023": return "That value isn't valid.";
  }
  // Our own SQL functions raise readable messages (e.g. "cannot remove the last admin"): pass those through.
  if (error.code === "P0001" && error.message.length < 200) return error.message.charAt(0).toUpperCase() + error.message.slice(1) + (error.message.endsWith(".") ? "" : ".");
  const r = ref();
  console.error(JSON.stringify({ level: "error", ref: r, context, code: error.code, message: error.message, details: error.details, hint: error.hint }));
  return `Something went wrong (ref ${r}). Please try again.`;
}

/** Any thrown value → a safe message. Errors we throw ourselves carry user-facing text; database errors do not. */
export function safeError(e: unknown, context: string): string {
  if (e instanceof DbError) return dbError(e.db, context);
  if (e instanceof ZodError) return e.issues[0]?.message ? `That value isn't valid: ${e.issues[0].message}` : "That value isn't valid.";
  if (e instanceof Error && !("code" in e)) return e.message || "Something went wrong.";
  const err = e as { code?: string; message?: string };
  return dbError({ code: err?.code, message: String(err?.message ?? e) }, context);
}

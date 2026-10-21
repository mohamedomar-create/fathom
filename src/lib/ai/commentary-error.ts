/** Why commentary could not be written, kept apart from the server-only writer so the status rule can be tested. */
export class CommentaryError extends Error {
  constructor(message: string, readonly kind: "not_configured" | "upstream" = "upstream") { super(message); }
}
/** Not switched on is "unavailable" (503); a failure of the AI service itself is a bad gateway (502). */
export const commentaryStatus = (e: CommentaryError) => (e.kind === "not_configured" ? 503 : 502);

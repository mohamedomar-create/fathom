/**
 * An active page with nothing to fetch (a long form) calls this every few minutes; the proxy refreshes the last-seen
 * stamp on the way, so the server's 30-minute idle check never ends a session the person is using.
 */
export const dynamic = "force-dynamic";
export function GET() {
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

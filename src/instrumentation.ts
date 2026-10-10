import type { Instrumentation } from "next";

export function register() {}

/** One structured log line per server error, with the digest the error page shows, so a user's reference finds the cause. */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const e = err as Error & { digest?: string };
  console.error(JSON.stringify({
    level: "error", digest: e.digest, message: e.message, stack: e.stack?.split("\n").slice(0, 6).join("\n"),
    method: request.method, path: request.path.split("?")[0], route: context.routePath, kind: context.routerKind, type: context.routeType,
  }));
};

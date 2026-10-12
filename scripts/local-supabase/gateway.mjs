// A stand-in for Supabase's API gateway: /auth/v1 → GoTrue, /rest/v1 → PostgREST, everything else 404.
import http from "node:http";
const [port, authPort, restPort] = process.argv.slice(2).map(Number);
const routes = [["/auth/v1", authPort], ["/rest/v1", restPort]];
http.createServer((req, res) => {
  const hit = routes.find(([p]) => req.url === p || req.url.startsWith(p + "/") || req.url.startsWith(p + "?"));
  if (!hit) { res.writeHead(404).end(); return; }
  const [prefix, target] = hit;
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": req.headers.origin ?? "*", "access-control-allow-credentials": "true", "access-control-allow-headers": req.headers["access-control-request-headers"] ?? "*", "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS" }).end();
    return;
  }
  const up = http.request({ host: "127.0.0.1", port: target, path: req.url.slice(prefix.length) || "/", method: req.method, headers: { ...req.headers, host: `127.0.0.1:${target}` } }, (r) => {
    res.writeHead(r.statusCode ?? 502, { ...r.headers, "access-control-allow-origin": req.headers.origin ?? "*", "access-control-allow-credentials": "true" });
    r.pipe(res);
  });
  up.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(up);
}).listen(port, "127.0.0.1", () => console.log(`gateway on ${port}`));

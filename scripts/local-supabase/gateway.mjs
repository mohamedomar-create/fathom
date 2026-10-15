// A stand-in for Supabase's API gateway: /auth/v1 → GoTrue, /rest/v1 → PostgREST, /storage/v1/upload/resumable → a small
// TUS (resumable upload) store on disk, enough for the import tests. Everything else 404.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const [port, authPort, restPort, storeDir = ".local-supabase/storage"] = process.argv.slice(2).map((v, i) => (i < 3 ? Number(v) : v));
const routes = [["/auth/v1", authPort], ["/rest/v1", restPort]];
const TUS = "/storage/v1/upload/resumable";
const uploads = new Map(); // id → { length, offset, file }
const cors = (req, extra = {}) => ({
  "access-control-allow-origin": req.headers.origin ?? "*", "access-control-allow-credentials": "true",
  "access-control-expose-headers": "Location, Upload-Offset, Upload-Length, Tus-Resumable", ...extra,
});

function tus(req, res) {
  const id = req.url.slice(TUS.length + 1).split("?")[0];
  if (req.method === "POST") {
    const meta = Object.fromEntries((req.headers["upload-metadata"] ?? "").split(",").filter(Boolean).map((kv) => { const [k, v = ""] = kv.trim().split(" "); return [k, Buffer.from(v, "base64").toString()]; }));
    if (!meta.objectName || !meta.bucketName) { res.writeHead(400, cors(req)).end("metadata required"); return; }
    if (!/^Bearer /.test(req.headers.authorization ?? "")) { res.writeHead(401, cors(req)).end("sign in"); return; }
    const key = crypto.randomUUID();
    const file = path.join(storeDir, meta.bucketName, meta.objectName);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "");
    const u = { length: Number(req.headers["upload-length"]), offset: 0, file };
    uploads.set(key, u);
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      if (body.length) { fs.appendFileSync(file, body); u.offset += body.length; }
      res.writeHead(201, cors(req, { Location: `http://${req.headers.host}${TUS}/${key}`, "Upload-Offset": String(u.offset), "Tus-Resumable": "1.0.0" })).end();
    });
    return;
  }
  const u = uploads.get(id);
  if (!u) { res.writeHead(404, cors(req)).end(); return; }
  if (req.method === "HEAD") { res.writeHead(200, cors(req, { "Upload-Offset": String(u.offset), "Upload-Length": String(u.length), "Tus-Resumable": "1.0.0", "Cache-Control": "no-store" })).end(); return; }
  if (req.method === "PATCH") {
    if (Number(req.headers["upload-offset"]) !== u.offset) { res.writeHead(409, cors(req)).end(); return; }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      fs.appendFileSync(u.file, body); u.offset += body.length;
      res.writeHead(204, cors(req, { "Upload-Offset": String(u.offset), "Tus-Resumable": "1.0.0" })).end();
    });
    return;
  }
  res.writeHead(405, cors(req)).end();
}

http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": req.headers.origin ?? "*", "access-control-allow-credentials": "true", "access-control-allow-headers": req.headers["access-control-request-headers"] ?? "*", "access-control-allow-methods": "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS", "access-control-expose-headers": "Location, Upload-Offset, Upload-Length, Tus-Resumable" }).end();
    return;
  }
  if (req.url === TUS || req.url.startsWith(TUS + "/") || req.url.startsWith(TUS + "?")) { tus(req, res); return; }
  const hit = routes.find(([p]) => req.url === p || req.url.startsWith(p + "/") || req.url.startsWith(p + "?"));
  if (!hit) { res.writeHead(404).end(); return; }
  const [prefix, target] = hit;
  const up = http.request({ host: "127.0.0.1", port: target, path: req.url.slice(prefix.length) || "/", method: req.method, headers: { ...req.headers, host: `127.0.0.1:${target}` } }, (r) => {
    res.writeHead(r.statusCode ?? 502, { ...r.headers, "access-control-allow-origin": req.headers.origin ?? "*", "access-control-allow-credentials": "true" });
    r.pipe(res);
  });
  up.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(up);
}).listen(port, "127.0.0.1", () => console.log(`gateway on ${port}`));

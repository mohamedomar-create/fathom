import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";

// Everything that is not the public internet: private, loopback, link-local, CGNAT, benchmarking, documentation,
// multicast/reserved, and IPv6 forms that embed IPv4 (mapped, NAT64, 6to4, Teredo).
const blocked = new BlockList();
for (const [net, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24],
  ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) blocked.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [["::", 128], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 32], ["2001:db8::", 32],
  ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) blocked.addSubnet(net, bits, "ipv6");

/** "::ffff:7f00:1" or "::ffff:127.0.0.1" → "127.0.0.1"; null for other addresses. */
function mappedV4(ip: string): string | null {
  const m = ip.toLowerCase().match(/^(?:0{0,4}:){0,5}:?ffff:(.+)$/);
  if (!m) return null;
  if (isIP(m[1]) === 4) return m[1];
  const h = m[1].match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!h) return null;
  const a = parseInt(h[1], 16), b = parseInt(h[2], 16);
  return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
}

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return blocked.check(ip, "ipv4");
  if (v === 6) { const m = mappedV4(ip); return m ? blocked.check(m, "ipv4") : blocked.check(ip, "ipv6"); }
  return true;
}

export interface OdooTarget { url: string; address: string; family: 4 | 6 }

/**
 * Normalise an Odoo base URL and resolve it once, refusing anything on a private or internal network (SSRF guard).
 * The checked address is returned so the connection can be pinned to it: a DNS answer that changes between the check
 * and the request (DNS rebinding) cannot redirect the request inside the network.
 */
export async function resolvePublicOdoo(raw: string, resolve = lookup): Promise<OdooTarget> {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new Error("That doesn't look like a valid URL, e.g. https://yourcompany.odoo.com"); }
  if (u.protocol !== "https:") throw new Error("Use the https:// address of your Odoo.");
  if (u.username || u.password) throw new Error("Remove the username/password from the URL.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) throw new Error("Odoo must be reachable on the public internet.");
  const addrs = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolve(host, { all: true }).catch(() => { throw new Error(`Could not find ${host}. Check the address.`); });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error("Odoo must be reachable on the public internet (private network addresses are not allowed).");
  const path = u.pathname.replace(/\/(web|odoo)(\/.*)?$/, "").replace(/\/+$/, "");
  return { url: `${u.protocol}//${u.host}${path}`, address: addrs[0].address, family: addrs[0].family === 6 ? 6 : 4 };
}

export async function assertPublicOdooUrl(raw: string, resolve = lookup): Promise<string> {
  return (await resolvePublicOdoo(raw, resolve)).url;
}

const MAX_BODY = 60 * 1024 * 1024;

/**
 * A fetch that connects only to the checked address (TLS still verifies the real host name) and never follows redirects.
 * Enough of fetch for the Odoo JSON-RPC client: method, headers, body, signal → Response.
 */
export function pinnedFetch(target: OdooTarget): typeof fetch {
  return ((input: string | URL, init: RequestInit = {}) => new Promise<Response>((resolveRes, reject) => {
    const url = new URL(String(input));
    if (url.origin !== new URL(target.url).origin) { reject(new Error("Request outside the checked Odoo address")); return; }
    const req = request(url, {
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      signal: init.signal ?? undefined,
      lookup: (_host, opts, cb) => {
        const o = opts as { all?: boolean };
        if (o.all) (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: target.address, family: target.family }]);
        else cb(null, target.address, target.family);
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => { size += c.length; if (size > MAX_BODY) { req.destroy(new Error("Odoo's answer is too large")); return; } chunks.push(c); });
      res.on("end", () => {
        const status = res.statusCode ?? 0;
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (typeof v === "string") headers.set(k, v);
        resolveRes(new Response(status === 204 || status === 304 ? null : Buffer.concat(chunks), { status: status >= 200 && status <= 599 ? status : 502, headers }));
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    if (init.body) req.write(init.body as string);
    req.end();
  })) as typeof fetch;
}

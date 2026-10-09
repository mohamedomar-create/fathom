import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function privateV4(ip: string) {
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
function privateV6(ip: string) {
  const s = ip.toLowerCase();
  return s === "::1" || s === "::" || s.startsWith("fc") || s.startsWith("fd") || s.startsWith("fe80") || (s.startsWith("::ffff:") && privateV4(s.slice(7)));
}

/** Normalise and validate an Odoo base URL; refuse anything that resolves to a private/internal address (SSRF guard). */
export async function assertPublicOdooUrl(raw: string, resolve = lookup): Promise<string> {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new Error("That doesn't look like a valid URL, e.g. https://yourcompany.odoo.com"); }
  if (u.protocol !== "https:") throw new Error("Use the https:// address of your Odoo.");
  if (u.username || u.password) throw new Error("Remove the username/password from the URL.");
  const host = u.hostname;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Odoo must be reachable on the public internet.");
  const addrs = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolve(host, { all: true }).catch(() => { throw new Error(`Could not find ${host}. Check the address.`); });
  for (const a of addrs) if ((a.family === 4 && privateV4(a.address)) || (a.family === 6 && privateV6(a.address))) throw new Error("Odoo must be reachable on the public internet (private network addresses are not allowed).");
  const path = u.pathname.replace(/\/(web|odoo)(\/.*)?$/, "").replace(/\/+$/, "");
  return `${u.protocol}//${u.host}${path}`;
}
